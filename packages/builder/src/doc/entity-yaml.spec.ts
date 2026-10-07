import { describe, expect, it } from 'vitest';
import { formatKeyPath, parseKeyPath } from '@ueberblick/core';
import fc from 'fast-check';
import { parse } from 'yaml';
import { openProject, type Doc } from './index';
import { musterstadt, open, projects } from './fixtures';

/** Every entity path of the effective file that the Code view shows. */
function entityPaths(doc: Doc): string[] {
  const e = doc.effective() as unknown as Record<string, Record<string, { properties?: object }>>;
  const out: string[] = [];
  for (const section of ['types', 'tasks', 'rules']) {
    for (const k of Object.keys(e[section] ?? {})) {
      out.push(formatKeyPath([section, k]));
      for (const p of Object.keys(e[section]?.[k]?.properties ?? {}))
        if (section === 'types') out.push(formatKeyPath([section, k, 'properties', p]));
    }
  }
  return out;
}

const plain = (): Doc =>
  openProject(musterstadt.templateSrc, 'schema: ueberblick/1\nextends: baumkataster@1\n');

const edit = (doc: Doc, path: string, f: (data: Record<string, unknown>) => void) => {
  const data = parse(doc.entityYaml(path).text) as Record<string, unknown>;
  f(data);
  return doc.applyEntityYaml(path, JSON.stringify(data));
};

describe('entityYaml', () => {
  it('round trip: no ops for every entity of every golden project', () => {
    let n = 0;
    for (const p of projects) {
      const doc = openProject(p.templateSrc, p.overlaySrc);
      for (const path of entityPaths(doc)) {
        const r = doc.applyEntityYaml(path, doc.entityYaml(path).text);
        expect(r, `${p.name} ${path}`).toEqual({ ok: true, ops: [] });
        n++;
      }
    }
    expect(n).toBeGreaterThan(20);
  });

  it('round trip holds for a fresh overlay too', () => {
    const doc = plain();
    for (const path of entityPaths(doc)) {
      expect(doc.applyEntityYaml(path, doc.entityYaml(path).text)).toEqual({ ok: true, ops: [] });
    }
  });

  it('gives one line entry per text line, provenance as Doc.provenance says', () => {
    for (const p of projects) {
      const doc = openProject(p.templateSrc, p.overlaySrc);
      for (const path of entityPaths(doc)) {
        const { text, lines } = doc.entityYaml(path);
        expect(lines.length).toBe(text.trimEnd().split('\n').length);
        lines.forEach((l, i) => {
          expect(l.line).toBe(i + 1);
          expect(l.provenance).toBe(doc.provenance(l.path));
          expect(parseKeyPath(l.path)).not.toBeNull();
        });
      }
    }
  });

  it('marks overridden lines and starts at the entity path', () => {
    const doc = open();
    const lines = doc.entityYaml('tasks.kontrolle').lines;
    expect(lines.some((l) => l.provenance === 'changed')).toBe(true);
    expect(lines.every((l) => l.path.startsWith('tasks.kontrolle'))).toBe(true);
  });

  it('other paths give nothing', () => {
    expect(open().entityYaml('views.karte')).toEqual({ text: '', lines: [] });
    expect(open().entityYaml('types.nope')).toEqual({ text: '', lines: [] });
  });
});

describe('applyEntityYaml: one op per kind', () => {
  it('a changed scalar is a set', () => {
    const r = edit(plain(), 'types.baum', (d) => (d['label'] = 'Gehölz'));
    expect(r).toEqual({ ok: true, ops: [{ kind: 'set', path: 'types.baum.label', value: 'Gehölz' }] });
  });

  it('a new key is an add', () => {
    const r = edit(plain(), 'types.baum', (d) => {
      (d['properties'] as Record<string, unknown>)['notiz'] = { type: 'text', label: 'Notiz' };
    });
    expect(r).toEqual({
      ok: true,
      ops: [{ kind: 'add', path: 'types.baum.properties.notiz', value: { type: 'text', label: 'Notiz' } }],
    });
  });

  it('a deleted template key is a hide', () => {
    const doc = plain();
    const key = 'standort_hinweis';
    expect(key).toBeDefined();
    const r = edit(
      doc,
      'types.baum',
      (d) => delete (d['properties'] as Record<string, unknown>)['standort_hinweis'],
    );
    expect(r).toEqual({ ok: true, ops: [{ kind: 'hide', path: `types.baum.properties.${key}` }] });
  });

  it('a deleted added key is a reset', () => {
    const base = plain().apply({
      kind: 'add',
      path: 'types.baum.properties.notiz',
      value: { type: 'text', label: 'Notiz' },
    });
    expect(base.refused).toBeUndefined();
    const r = edit(
      base.doc,
      'types.baum',
      (d) => delete (d['properties'] as Record<string, unknown>)['notiz'],
    );
    expect(r).toEqual({ ok: true, ops: [{ kind: 'reset', path: 'types.baum.properties.notiz' }] });
  });

  it('a value set back to the template value is a reset', () => {
    const doc = plain();
    const orig = (doc.effective().types?.['baum'] as unknown as { label: unknown }).label;
    const changed = doc.apply({ kind: 'set', path: 'types.baum.label', value: 'X' }).doc;
    const r = edit(changed, 'types.baum', (d) => (d['label'] = orig));
    expect(r).toEqual({ ok: true, ops: [{ kind: 'reset', path: 'types.baum.label' }] });
  });

  it('the ops apply and give the typed entity', () => {
    const doc = plain();
    const r = edit(doc, 'types.baum', (d) => {
      d['label'] = 'Gehölz';
      (d['properties'] as Record<string, unknown>)['notiz'] = { type: 'text', label: 'N' };
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    let next = doc;
    for (const op of r.ops) {
      const a = next.apply(op);
      expect(a.refused).toBeUndefined();
      next = a.doc;
    }
    expect(next.effective().types?.['baum']).toMatchObject({ label: 'Gehölz' });
    expect(next.entityYaml('types.baum').text).toContain('notiz');
  });

  it('works on one property', () => {
    const r = edit(plain(), 'types.baum.properties.geometrie', (d) => (d['required'] = false));
    expect(r).toEqual({
      ok: true,
      ops: [{ kind: 'set', path: 'types.baum.properties.geometrie.required', value: false }],
    });
  });
});

describe('applyEntityYaml: problems, nothing applied', () => {
  it('a locked path is a lock_violation', () => {
    const doc = plain();
    const r = edit(doc, 'types.baum.properties.stage', (d) => {
      delete (d['options'] as Record<string, unknown>)['erledigt'];
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems[0]?.code).toBe('lock_violation');
    expect(doc.overlay().override).toBeUndefined();
  });

  it('invalid YAML names line and column', () => {
    const r = plain().applyEntityYaml('types.baum', 'label: a\nproperties: [unclosed\n  x: : 1\n');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems[0]?.line).toBeGreaterThanOrEqual(1);
    expect(r.problems[0]?.column).toBeGreaterThanOrEqual(1);
  });

  it('a result that breaks the schema returns problems', () => {
    const r = edit(plain(), 'types.baum', (d) => (d['properties'] = 5));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.length).toBeGreaterThan(0);
  });

  it('a new compile problem is returned', () => {
    const r = edit(plain(), 'types.baum', (d) => (d['geometry'] = 'gibt_es_nicht'));
    expect(r.ok).toBe(false);
  });

  it('not a map, or not an entity path', () => {
    expect(plain().applyEntityYaml('types.baum', '- a\n').ok).toBe(false);
    expect(plain().applyEntityYaml('views.karte', 'x: 1\n').ok).toBe(false);
  });
});

describe('property: edits then round trip', () => {
  const types = entityPaths(plain()).filter((p) => p.split('.').length === 2);
  it('after any applied label change the entity round-trips to no ops, lines match provenance', () => {
    fc.assert(
      fc.property(fc.constantFrom(...types), fc.string({ minLength: 1, maxLength: 8 }), (path, label) => {
        const doc = plain();
        expect(doc.applyEntityYaml(path, doc.entityYaml(path).text)).toEqual({ ok: true, ops: [] });
        const next = doc.apply({ kind: 'set', path: `${path}.label`, value: label }).doc;
        expect(next.applyEntityYaml(path, next.entityYaml(path).text)).toEqual({ ok: true, ops: [] });
        for (const l of next.entityYaml(path).lines) expect(l.provenance).toBe(next.provenance(l.path));
      }),
      { numRuns: 25 },
    );
  });
});
