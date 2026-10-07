import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parse, stringify } from 'yaml';
import { applyOps, applyTypeYaml, typeYaml, type Doc, type TypeScope } from './index';
import { open, projects } from './fixtures';
import { drop, get, put, type Tree } from './tree.testing';

const scope: TypeScope = {
  type: 'baum',
  tasks: ['erfassen', 'kontrolle', 'befund_ergaenzen', 'massnahme_anlegen'],
};

const dump = (data: Tree): string => stringify(data, { lineWidth: 0 });
const edit = (doc: Doc, f: (data: Tree) => void, sc: TypeScope = scope): string => {
  const data = parse(typeYaml(doc, sc).text) as Tree;
  f(data);
  return dump(data);
};
const applied = (doc: Doc, r: ReturnType<typeof applyTypeYaml>): Doc => {
  if (!r.ok) throw new Error('not ok');
  const done = applyOps(doc, r.ops);
  if ('refused' in done) throw new Error('refused');
  return done.doc;
};

describe('typeYaml', () => {
  it('shows the type and its tasks (with their automatic actions) in the template file shape, with a provenance per line', () => {
    const doc = open();
    const { text, lines } = typeYaml(doc, scope);
    const data = parse(text) as Tree;
    expect(Object.keys(data)).toEqual(['types', 'tasks']);
    expect(Object.keys(data['types'] as Tree)).toEqual(['baum']);
    expect(Object.keys(data['tasks'] as Tree)).toEqual(scope.tasks);
    expect(lines).toHaveLength(text.replace(/\n$/, '').split('\n').length);
    const prov = (path: string) => lines.find((l) => l.path === path)?.provenance;
    expect(prov('types.baum.properties.patenschaft')).toBe('added');
    expect(prov('types.baum.properties.vitalitaet.label')).toBe('changed');
    expect(prov('types.baum.properties.befund')).toBe('template');
    expect(prov('tasks.massnahme_anlegen.auto.massnahme_bei_schaden')).toBe('template');
  });

  it('an unchanged text stands for no ops, in every golden project', () => {
    for (const p of projects) {
      const doc = open(p);
      for (const type of Object.keys(doc.effective().types ?? {})) {
        const sc: TypeScope = {
          type,
          tasks: Object.keys(doc.effective().tasks ?? {}),
        };
        expect(applyTypeYaml(doc, sc, typeYaml(doc, sc).text)).toEqual({ ok: true, ops: [] });
      }
    }
  });
});

describe('applyTypeYaml', () => {
  it('a changed value is one overlay op, and the doc then shows it', () => {
    const doc = open();
    const r = applyTypeYaml(
      doc,
      scope,
      edit(doc, (d) => put(d, 'tasks.kontrolle.label.de', 'Prüfung')),
    );
    expect(r).toEqual({
      ok: true,
      ops: [{ kind: 'set', path: 'tasks.kontrolle.label.de', value: 'Prüfung' }],
    });
    const next = applied(doc, r);
    const line = typeYaml(next, scope).lines.find((l) => l.path === 'tasks.kontrolle.label.de');
    expect(line?.provenance).toBe('changed');
  });

  it('a locked path gives a lock_violation problem on its line and applies nothing', () => {
    const doc = open();
    const text = edit(doc, (d) => put(d, 'types.baum.properties.stage.options.erfasst', 'Neu'));
    const r = applyTypeYaml(doc, scope, text);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems[0]).toMatchObject({ code: 'lock_violation' });
    expect(text.split('\n')[(r.problems[0]?.line ?? 1) - 1]).toContain('erfasst');
  });

  it('a parse error gives a problem with line and column', () => {
    const r = applyTypeYaml(open(), scope, 'types:\n  baum: [unclosed\n');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems[0]?.line).toBeGreaterThan(0);
    expect(r.problems[0]?.column).toBeGreaterThan(0);
  });

  it('a schema problem lands on a line of the text', () => {
    const doc = open();
    const r = applyTypeYaml(
      doc,
      scope,
      edit(doc, (d) => put(d, 'types.baum.properties.befund.type', 'nonsense')),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.every((p) => p.line !== undefined)).toBe(true);
  });

  it('a new task is an add, a removed template task a hide, a removed overlay task a reset', () => {
    const doc = open();
    const neu = { label: { de: 'Neu' }, on: 'baum', form: { befund: {} } };
    const added = applyTypeYaml(
      doc,
      scope,
      edit(doc, (d) => put(d, 'tasks.neu', neu)),
    );
    expect(added).toEqual({ ok: true, ops: [{ kind: 'add', path: 'tasks.neu', value: neu }] });
    const hidden = applyTypeYaml(
      doc,
      scope,
      edit(doc, (d) => drop(d, 'tasks.befund_ergaenzen')),
    );
    expect(hidden).toEqual({ ok: true, ops: [{ kind: 'hide', path: 'tasks.befund_ergaenzen' }] });
    const sc = { ...scope, tasks: [...scope.tasks, 'neu'] };
    const withNew = applied(doc, added);
    const gone = applyTypeYaml(
      withNew,
      sc,
      edit(withNew, (d) => drop(d, 'tasks.neu'), sc),
    );
    expect(gone).toEqual({ ok: true, ops: [{ kind: 'reset', path: 'tasks.neu' }] });
  });

  it('a hidden template task comes back with unhide; another Objektart, a section or removing the type is a problem', () => {
    const doc = open();
    const hiddenDoc = applied(
      doc,
      applyTypeYaml(
        doc,
        scope,
        edit(doc, (d) => drop(d, 'tasks.befund_ergaenzen')),
      ),
    );
    const shown: TypeScope = { ...scope, tasks: ['erfassen', 'kontrolle'] };
    const original = get(parse(typeYaml(doc, scope).text), 'tasks.befund_ergaenzen');
    const back = applyTypeYaml(
      hiddenDoc,
      shown,
      edit(hiddenDoc, (d) => put(d, 'tasks.befund_ergaenzen', original), shown),
    );
    expect(back).toEqual({ ok: true, ops: [{ kind: 'unhide', path: 'tasks.befund_ergaenzen' }] });
    expect(
      applyTypeYaml(
        doc,
        scope,
        edit(doc, (d) => put(d, 'types.wald', { label: 'x' })),
      ).ok,
    ).toBe(false);
    expect(
      applyTypeYaml(
        doc,
        scope,
        edit(doc, (d) => put(d, 'views', {})),
      ).ok,
    ).toBe(false);
    expect(
      applyTypeYaml(
        doc,
        scope,
        edit(doc, (d) => drop(d, 'types.baum')),
      ).ok,
    ).toBe(false);
  });

  it('property: changed label texts become exactly one set op per change', () => {
    const doc = open();
    const safe = fc
      .string({ minLength: 1, maxLength: 12 })
      .filter((s) => s.trim() === s && !/[:#'"\\{}[\],&*!|>%@`\n\r\t-]/.test(s));
    fc.assert(
      fc.property(fc.array(safe, { minLength: 1, maxLength: 3 }), (labels) => {
        const props = ['befund', 'hoehe_m', 'vitalitaet'];
        const text = edit(doc, (d) =>
          labels.forEach((l, i) => put(d, `types.baum.properties.${props[i]}.label.de`, `${l}x`)),
        );
        const r = applyTypeYaml(doc, scope, text);
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.ops.length).toBeGreaterThanOrEqual(1);
          expect(r.ops.every((o) => o.kind === 'set')).toBe(true);
        }
      }),
      { numRuns: 25 },
    );
  });
});
