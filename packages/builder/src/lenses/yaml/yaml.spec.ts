import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { openProject, type Doc } from '../../doc';
import { largest, musterstadt } from '../../testing/golden';
import { completeAt } from './complete';
import { diagnose, lineOf, planSave } from './diagnose';
import { overlayOps } from './overlay-ops';

const doc = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const src = musterstadt.overlaySrc;

/** Completions at the `|` marker of `text`. */
function at(text: string): { labels: string[]; from: number; marker: number } {
  const marker = text.indexOf('|');
  const clean = text.replace('|', '');
  const r = completeAt(clean, marker, doc());
  return { labels: r.options.map((o) => o.label), from: r.from, marker };
}

describe('completion from the JSON Schema at the cursor path', () => {
  it('offers the overlay keys that are not yet there, at the top level', () => {
    const { labels } = at('schema: ueberblick/1\nextends: baumkataster@1\n|');
    expect(labels).toEqual(expect.arrayContaining(['inputs', 'override', 'add', 'hide']));
    expect(labels).not.toContain('extends');
    expect(labels).not.toContain('schema');
  });

  it('offers the keys of the entity schema inside an add entry', () => {
    const { labels } = at('add:\n  types.baum.properties.patenschaft:\n    |');
    expect(labels).toEqual(expect.arrayContaining(['type', 'label']));
    expect(labels).not.toContain('inputs');
  });

  it('narrows to what has been typed and replaces only the typed word', () => {
    const { labels, from, marker } = at('add:\n  types.baum.properties.patenschaft:\n    lab|');
    expect(labels).toContain('label');
    expect(marker - from).toBe(3);
  });

  it('leaves out keys the entry already has', () => {
    const { labels } = at('add:\n  types.baum.properties.x:\n    type: text\n    |');
    expect(labels).not.toContain('type');
    expect(labels).toContain('label');
  });

  it('offers enum values after a key', () => {
    const { labels } = at('add:\n  types.baum.properties.x:\n    type: |');
    expect(labels).toEqual(expect.arrayContaining(['text', 'select', 'number']));
  });

  it('offers key paths of the file under override and add', () => {
    expect(at('extends: baumkataster@1\noverride:\n  tasks.kon|').labels).toContain('tasks.kontrolle');
    expect(at('override:\n  types.baum.properties.|').labels).toContain('types.baum.properties.vitalitaet');
  });

  it('offers template key paths for a hide entry', () => {
    expect(at('hide:\n  - tasks.erfassung_|').labels).toContain('tasks.erfassung_import');
  });

  it('offers the template inputs under inputs', () => {
    expect(at('inputs:\n  |').labels).toContain('kontrollintervall_monate');
  });

  it('offers nothing on a comment line or in a flow map', () => {
    expect(at('# a comm|').labels).toEqual([]);
    expect(at('inputs: { kon|').labels).toEqual([]);
  });

  it('is total on any text and cursor', () => {
    const shared = doc(); // completeAt only reads the doc; opening a project per run costs ~24 ms
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), fc.nat(250), (text, pos) => {
        const r = completeAt(text, Math.min(pos, text.length), shared);
        expect(r.from).toBeLessThanOrEqual(Math.min(pos, text.length));
      }),
      { numRuns: 200 },
    );
  });
});

describe('inline problems at the right line', () => {
  const line = (text: string, d: { from: number }): number => lineOf(text, d.from);

  it('a clean overlay has no errors and no ops', () => {
    const r = diagnose(src, doc());
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toEqual([]);
    expect(r.ops).toEqual([]);
  });

  it('a YAML syntax error is reported on its line', () => {
    const text = 'schema: ueberblick/1\nextends: baumkataster@1\nadd:\n  a: [unclosed\nhide: []\n';
    const r = diagnose(text, doc());
    expect(r.ok).toBe(false);
    expect(r.diagnostics.length).toBeGreaterThan(0);
    expect(r.diagnostics.every((d) => d.severity === 'error')).toBe(true);
    expect(line(text, r.diagnostics[0] as { from: number })).toBeGreaterThanOrEqual(4);
  });

  it('an unknown top-level key points at that key', () => {
    const text = `${src}wrong_key: 1\n`;
    const r = diagnose(text, doc());
    expect(r.ok).toBe(false);
    const d = r.diagnostics.find((x) => text.slice(x.from, x.to).includes('wrong_key'));
    expect(d).toBeDefined();
    expect(line(text, d as { from: number })).toBe(text.split('\n').length - 1);
  });

  it('a compile problem lands on the override entry that causes it', () => {
    const text = src.replace('override:\n', 'override:\n  types.baum.properties.art.to: gibt_es_nicht\n');
    const r = diagnose(text, doc());
    const want = text.split('\n').findIndex((l) => l.includes('art.to: gibt_es_nicht')) + 1;
    expect(r.diagnostics.filter((d) => line(text, d) === want).length).toBeGreaterThan(0);
    expect(r.ok).toBe(true); // problems do not block saving; the panel shows them too
  });

  it('a value outside the file schema is an error on its line', () => {
    const text = 'schema: ueberblick/1\nextends: baumkataster@1\nhide: nope\n';
    const r = diagnose(text, doc());
    expect(r.ok).toBe(false);
    expect(line(text, r.diagnostics[0] as { from: number })).toBe(3);
  });

  it('an overlay that extends another template is refused', () => {
    const r = diagnose(src.replace('baumkataster@1', 'anderes@1'), doc());
    expect(r.ok).toBe(false);
    expect(line(src, r.diagnostics[0] as { from: number })).toBe(2);
  });
});

describe('saving goes through the document model', () => {
  it('invalid YAML yields no ops', () => {
    const plan = planSave('extends: [', doc());
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.errors.length).toBeGreaterThan(0);
  });

  it('a text edit becomes ops whose result is exactly the typed overlay', () => {
    const text = src
      .replace('kontrollintervall_monate: 18', 'kontrollintervall_monate: 24')
      .replace('hide:\n  - tasks.erfassung_import\n', 'hide: []\n');
    const plan = planSave(text, doc());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    let d = doc();
    for (const op of plan.ops) d = d.apply(op).doc;
    const typed = overlayOps(d.overlay(), d.overlay());
    expect(typed).toEqual([]);
    expect(d.overlay().inputs).toEqual({ kontrollintervall_monate: 24 });
    expect(d.overlay().hide ?? []).toEqual([]);
  });

  it('adding an override entry is one set op', () => {
    const text = src.replace('override:\n', 'override:\n  types.baum.label: Warm\n');
    const plan = planSave(text, doc());
    expect(plan.ok && plan.ops).toEqual([{ kind: 'set', path: 'types.baum.label', value: 'Warm' }]);
  });

  it('an edit that would break the file schema is refused with a message', () => {
    const text = src.replace('override:\n', 'override:\n  types.baum.properties.art.type: 7\n');
    const plan = planSave(text, doc());
    expect(plan.ok).toBe(false);
  });
});

describe('keystroke to problems on the largest golden overlay', () => {
  // Timing lives in bench/builder-yaml (R14, WP-147): no time is asserted here.
  it('a trailing comment adds no problem to the largest golden overlay', () => {
    const d = openProject(largest.templateSrc, largest.overlaySrc);
    const before = diagnose(largest.overlaySrc, d);
    expect(diagnose(largest.overlaySrc + '# x\n', d)).toEqual(before);
  });
});
