import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseKeyPath } from '@ueberblick/core';
import { openProject, type Op } from './index';
import { valueAt } from './ops';
import { freshProblems, musterstadt, open, project, set } from './fixtures';

describe('an op never silently does nothing (R11)', () => {
  const run = (...ops: Op[]) => {
    let doc = open();
    const refusals: (string | undefined)[] = [];
    for (const o of ops) {
      const r = doc.apply(o);
      doc = r.doc;
      refusals.push(r.refused?.message);
      expect(r.problems).toEqual(freshProblems(musterstadt.templateSrc, doc.save().overlaySrc));
    }
    return { doc, refusals };
  };

  it('set on a path the template lacks is written as an add and takes effect', () => {
    const doc = openProject(
      project('musterstadt-plain.yaml').templateSrc,
      'schema: ueberblick/1\nextends: baumkataster@1\n',
    );
    const r = doc.apply(set('views.neu', { label: 'N', source: { type: 'baum' } }));
    expect(r.refused).toBeUndefined();
    expect(r.doc.overlay().add?.['views.neu']).toBeDefined();
    expect(r.doc.overlay().override).toBeUndefined();
    expect(r.doc.effective().views?.['neu']).toBeDefined();
  });

  it('set on a hidden path is refused: the effective file would not have it', () => {
    const { doc, refusals } = run(
      { kind: 'hide', path: 'tasks.kontrolle' },
      set('tasks.kontrolle.label', 'L'),
    );
    expect(refusals[1]).toContain('tasks.kontrolle');
    expect(doc.overlay().override?.['tasks.kontrolle.label']).toEqual(
      open().overlay().override?.['tasks.kontrolle.label'],
    );
  });

  it('hide of a path the template lacks is refused', () => {
    expect(run({ kind: 'hide', path: 'tasks.nope' }).refusals[0]).toContain('tasks.nope');
  });

  it('set below an earlier scalar set is refused, not overwriting the scalar', () => {
    const { doc, refusals } = run(set('types.baum.label', 'X'), set('types.baum.label.de', 'Y'));
    expect(refusals[1]).toContain('Reset types.baum.label first');
    expect(doc.overlay().override?.['types.baum.label']).toBe('X');
  });

  it('add below an earlier scalar set is refused', () => {
    const { doc, refusals } = run(set('types.baum.label', 'X'), {
      kind: 'add',
      path: 'types.baum.label.de',
      value: 'Y',
    });
    expect(refusals[1]).toBeDefined();
    expect(doc.overlay().override?.['types.baum.label']).toBe('X');
  });

  it('reset below an earlier scalar set is refused, and reset of the scalar itself works', () => {
    const scalar = run(set('types.baum.label', 'X'));
    const below = run(set('types.baum.label', 'X'), { kind: 'reset', path: 'types.baum.label.de' });
    expect(below.refusals[1]).toContain('Reset types.baum.label first');
    expect(below.doc.save().overlaySrc).toBe(scalar.doc.save().overlaySrc);
    const back = run(set('types.baum.label', 'X'), { kind: 'reset', path: 'types.baum.label' });
    expect(back.refusals[1]).toBeUndefined();
    expect(back.doc.overlay().override?.['types.baum.label']).toBeUndefined();
  });
});

describe('no silent no-op over random op sequences', () => {
  const paths = [
    'types.baum.label',
    'types.baum.properties.vitalitaet.label',
    'types.baum.properties.befund.label',
    'types.baum.properties.patenschaft',
    'types.baum.properties.patenschaft.label',
    'types.baum.properties.stage.options',
    'tasks.kontrolle.label',
    'tasks.kontrolle',
    'tasks.melden',
    'tasks.erfassung_import',
    'views.paten',
    'views.paten.label',
    'views.neu',
    'views.karte',
    'inputs.kontrollintervall_monate',
    'nothing.here',
    'Bad..Path',
  ];
  const value = fc.oneof(
    fc.string({ maxLength: 8 }),
    fc.integer({ min: 1, max: 60 }),
    fc.constant({ de: 'X', en: 'Y' }),
  );
  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ kind: fc.constant('set' as const), path: fc.constantFrom(...paths), value }),
    fc.record({
      kind: fc.constant('add' as const),
      path: fc.constantFrom(...paths),
      value: fc.constant({ label: 'L', source: { type: 'baum' } }),
    }),
    fc.record({ kind: fc.constant('hide' as const), path: fc.constantFrom(...paths) }),
    fc.record({ kind: fc.constant('unhide' as const), path: fc.constantFrom(...paths) }),
    fc.record({ kind: fc.constant('reset' as const), path: fc.constantFrom(...paths) }),
  );
  const seq = fc.array(op, { maxLength: 6 });

  it('after every op either refused is set or the effective file is as the op says', () => {
    fc.assert(
      fc.property(seq, (ops) => {
        let doc = open();
        for (const o of ops) {
          const r = doc.apply(o);
          if (r.refused) {
            expect(r.doc).toBe(doc);
            expect(r.refused.message.length).toBeGreaterThan(0);
            continue;
          }
          doc = r.doc;
          const segs = parseKeyPath(o.path) ?? [];
          const at = (root: unknown, path: readonly string[]) => valueAt(root, path);
          if (o.kind === 'set' && segs[0] === 'inputs') {
            expect(at(doc.effective(), [...segs, 'default'])).toEqual(o.value);
          } else if (o.kind === 'set' || o.kind === 'add') {
            expect(at(doc.effective(), segs)).toEqual(o.value);
          } else if (o.kind === 'hide') {
            expect(at(doc.effective(), segs)).toBeUndefined();
          } else if (o.kind === 'unhide') {
            expect(doc.overlay().hide ?? []).not.toContain(o.path);
          }
        }
      }),
      { numRuns: 16 },
    );
  });
});

describe('replaceOverlay', () => {
  const typed = `# my notes
schema: ueberblick/1
extends: baumkataster@1
hide:   [ tasks.erfassung_import ]   # keep spacing
inputs:
    kontrollintervall_monate: 12
`;

  it('keeps the text byte for byte: comments, key order and layout', () => {
    const r = open().replaceOverlay(typed);
    expect(r.refused).toBeUndefined();
    expect(r.doc.save().overlaySrc).toBe(typed);
    expect(r.doc.dirty).toBe(true);
    expect(r.doc.overlay().inputs).toEqual({ kontrollintervall_monate: 12 });
    expect(r.doc.effective().inputs?.['kontrollintervall_monate']?.default).toBe(12);
    expect(r.problems).toEqual(freshProblems(musterstadt.templateSrc, typed));
  });

  it('keeps the opened revision so saveIf still guards against a stale save', () => {
    const doc = open();
    const r = doc.replaceOverlay(typed).doc;
    expect(r.revision).toBe(doc.revision);
    const saved = r.saveIf(doc.revision);
    expect(saved.ok && saved.overlaySrc).toBe(typed);
    expect(saved.ok && saved.doc.dirty).toBe(false);
  });

  it('the next op works on the typed text and keeps its comments', () => {
    const r = open().replaceOverlay(typed).doc.apply(set('inputs.kontrollintervall_monate', 9));
    expect(r.refused).toBeUndefined();
    expect(r.doc.save().overlaySrc).toContain('# my notes');
    expect(r.doc.save().overlaySrc).toContain('# keep spacing');
    expect(r.doc.overlay().inputs).toEqual({ kontrollintervall_monate: 9 });
  });

  it('the same text returns the same Doc', () => {
    const doc = open();
    expect(doc.replaceOverlay(musterstadt.overlaySrc).doc).toBe(doc);
  });

  it.each([
    ['not YAML', 'a: ['],
    ['not the overlay schema', 'schema: nope\n'],
    ['another template', typed.replace('baumkataster@1', 'veranstaltung@1')],
  ])('refuses text that is %s and leaves the Doc unchanged', (_n, text) => {
    const doc = open().apply(set('types.baum.label', 'X')).doc;
    const before = doc.save().overlaySrc;
    const r = doc.replaceOverlay(text);
    expect(r.refused?.message.length).toBeGreaterThan(0);
    expect(r.doc).toBe(doc);
    expect(r.doc.save().overlaySrc).toBe(before);
  });

  it('text that makes the effective file invalid is accepted with schema_invalid problems', () => {
    const r = open().replaceOverlay(`${typed}override:\n  types.baum.label: 5\n`);
    expect(r.refused).toBeUndefined();
    expect(r.problems.some((p) => p.code === 'schema_invalid')).toBe(true);
  });
});

describe('order op', () => {
  it('writes order.<path> and the effective map follows it', () => {
    const keys = Object.keys(open().effective().types ?? {});
    const next = [...keys].reverse();
    const r = open().apply({ kind: 'order', path: 'types', keys: next });
    expect(r.refused).toBeUndefined();
    expect(r.doc.overlay().order).toEqual({ types: next });
    expect(Object.keys(r.doc.effective().types ?? {})).toEqual(next);
    expect(r.doc.save().overlaySrc).toContain('order:');
  });

  it('is refused when the map or a key does not exist, and the doc stays', () => {
    const d = open();
    expect(d.apply({ kind: 'order', path: 'types', keys: ['gibt_es_nicht'] }).refused?.message).toContain(
      'gibt_es_nicht',
    );
    expect(d.apply({ kind: 'order', path: 'nirgends', keys: [] }).refused).toBeDefined();
  });

  it('keeps comments elsewhere in the overlay', () => {
    const r = open().apply({ kind: 'order', path: 'types', keys: ['baum'] });
    expect(r.doc.save().overlaySrc).toContain('# kept override on upgrade');
  });
});
