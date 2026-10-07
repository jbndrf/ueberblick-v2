// WP-371 (owner A2): the relation options are written as tasks and steps, rewritten (not duplicated) on every save,
// and they do what v3's options did when the project runs (core.plan through the simulator).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Actor, FeatureId, Key } from '@ueberblick/core';
import { openProject, type Doc } from '../../doc';
import { openSimulation } from '../../simulate';
import { buildInventory } from '../catalog/inventory';
import {
  createRelation,
  deleteRelation,
  listRelations,
  updateRelation,
  type RelationEdit,
  type RelationInput,
} from './ops';
import { createTaskKey, deleteTasksOf, type RelationRef } from './options';

const TEMPLATE = `
schema: ueberblick/1
template: { key: rel, version: 1.0.0 }
roles: { boss: { label: Boss }, worker: { label: Worker } }
types:
  eltern:
    label: Eltern
    permissions: { see: $all, create: $all, write: $all, delete: [boss, worker] }
    properties: { name: { type: text } }
  kind:
    label: Kind
    permissions: { see: $all, create: $all, write: [boss], delete: [boss] }
    properties: { name: { type: text } }
  gutachten:
    label: Gutachten
    permissions: { see: $all, create: $all, write: $all, delete: [boss] }
    properties: { name: { type: text } }
tasks:
  loeschen: { label: Löschen, on: eltern, who: [boss, worker], then: [{ lifecycle: deleted }] }
  kind_neu: { label: Kind neu, on: $map, who: [boss, worker], creates: kind }
`;
const NO_DELETE = TEMPLATE.replace(/\n {2}loeschen:.*\n/, '\n');
const open = (src = TEMPLATE): Doc => openProject(src, 'schema: ueberblick/1\nextends: rel@1\n');
const must = (r: RelationEdit): Doc => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.doc;
};
const NEW: RelationInput = { name: 'Kinder', parent: 'eltern', child: 'kind', cardinality: 'many' };
const REF: RelationRef = {
  parent: 'eltern',
  key: 'kinder',
  child: 'kind',
  refKey: 'eltern',
  cardinality: 'many',
};
const made = (o: Partial<RelationInput> = {}, src?: string): Doc =>
  must(createRelation(open(src), { ...NEW, ...o }, 'de'));
const tasks = (d: Doc) => d.effective().tasks ?? {};
const entry = (d: Doc) => listRelations(d, 'de').find((r) => r.id === 'eltern.kinder');

describe('Anbindung', () => {
  it("writes the child's creating task on the parent, binding the new child to it", () => {
    const t = tasks(made({ attachment: 'optional' }))[createTaskKey(REF)];
    expect(t).toMatchObject({ on: 'eltern', creates: 'kind', then: [{ set: { eltern: 'self' } }] });
    expect(t?.label).toEqual({ de: 'Kinder anlegen', en: 'Create Kinder' });
  });
  it('Verbindlich makes the reference required, Optional does not', () => {
    expect(made({ attachment: 'enforced' }).effective().types?.['kind']?.properties['eltern']?.required).toBe(
      true,
    );
    expect(
      made({ attachment: 'optional' }).effective().types?.['kind']?.properties['eltern']?.required,
    ).not.toBe(true);
  });
  it("is read back from the file, with v3's defaults on a new relation (enforced, nullify)", () => {
    expect(entry(made())).toMatchObject({ attachment: 'enforced', onDelete: 'nullify' });
    expect(entry(made({ attachment: 'optional', onDelete: 'block' }))).toMatchObject({
      attachment: 'optional',
      onDelete: 'block',
    });
  });
  it('switching the option rewrites the same entries', () => {
    const a = made({ attachment: 'enforced' });
    const b = must(updateRelation(a, 'eltern.kinder', { attachment: 'optional' }, 'de'));
    expect(entry(b)?.attachment).toBe('optional');
    expect(Object.keys(tasks(b)).filter((k) => k.startsWith('rel_'))).toEqual([createTaskKey(REF)]);
  });
});

describe('Wenn das Eltern-Element gelöscht wird', () => {
  it("mitlöschen: the delete task starts with the children's delete, then its own", () => {
    expect(tasks(made({ onDelete: 'cascade' }))['loeschen']?.then).toEqual([
      { lifecycle: 'deleted', of: 'self.kinder' },
      { lifecycle: 'deleted' },
    ]);
  });
  it('trennen: the delete task clears the reference on the children first', () => {
    expect(tasks(made({ onDelete: 'nullify' }))['loeschen']?.then).toEqual([
      { set: { eltern: null }, of: 'self.kinder' },
      { lifecycle: 'deleted' },
    ]);
  });
  it('blockieren: the delete task is available only without children', () => {
    const t = tasks(made({ onDelete: 'block' }))['loeschen'];
    expect(t?.when).toBe('self.kinder.size() == 0');
    expect(t?.then).toEqual([{ lifecycle: 'deleted' }]);
  });
  it('switching rewrites: nothing of the old choice stays, nothing is doubled', () => {
    let d = made({ onDelete: 'cascade' });
    for (const onDelete of ['block', 'nullify', 'cascade', 'cascade'] as const) {
      d = must(updateRelation(d, 'eltern.kinder', { onDelete }, 'de'));
      const t = tasks(d)['loeschen'];
      expect(t?.then?.filter((s) => s.of !== undefined)).toHaveLength(onDelete === 'block' ? 0 : 1);
      expect(t?.when === undefined).toBe(onDelete !== 'block');
      expect(entry(d)?.onDelete).toBe(onDelete);
    }
    expect(Object.keys(tasks(d)).sort()).toEqual(['kind_neu', 'loeschen', createTaskKey(REF)].sort());
  });
  it('a condition the delete task already has stays, with the operand next to it', () => {
    const base = open().apply({
      kind: 'set',
      path: 'tasks.loeschen.when',
      value: "'boss' in actor.roles",
    }).doc;
    const d = must(createRelation(base, { ...NEW, onDelete: 'block' }, 'de'));
    expect(tasks(d)['loeschen']?.when).toBe("'boss' in actor.roles && self.kinder.size() == 0");
    const back = must(updateRelation(d, 'eltern.kinder', { onDelete: 'nullify' }, 'de'));
    expect(tasks(back)['loeschen']?.when).toBe("'boss' in actor.roles");
  });
  it('two relations of one parent each keep their own steps and operand', () => {
    const one = must(createRelation(open(), { ...NEW, onDelete: 'cascade' }, 'de'));
    const two = must(
      createRelation(one, { ...NEW, name: 'Gutachten', child: 'gutachten', onDelete: 'block' }, 'de'),
    );
    const t = tasks(two)['loeschen'];
    expect(t?.then).toEqual([{ lifecycle: 'deleted', of: 'self.kinder' }, { lifecycle: 'deleted' }]);
    expect(t?.when).toBe('self.gutachten.size() == 0');
    const gone = deleteRelation(two, 'eltern.kinder');
    if ('refused' in gone) throw new Error(gone.refused);
    expect(tasks(gone.doc)['loeschen']?.then).toEqual([{ lifecycle: 'deleted' }]);
    expect(tasks(gone.doc)['loeschen']?.when).toBe('self.gutachten.size() == 0');
  });
  it('a parent with no delete task gets one only when mitlöschen or blockieren needs it', () => {
    expect(deleteTasksOf(made({ onDelete: 'nullify' }, NO_DELETE).effective(), 'eltern')).toEqual([]);
    for (const onDelete of ['cascade', 'block'] as const) {
      const d = made({ onDelete }, NO_DELETE);
      const found = deleteTasksOf(d.effective(), 'eltern');
      expect(found.map((t) => t.key)).toEqual(['rel_eltern_delete']);
      expect(entry(d)?.onDelete).toBe(onDelete);
    }
  });
  it('without a delete task the choice reads as the default (nothing to write, nothing to lose)', () => {
    expect(entry(made({ onDelete: 'nullify' }, NO_DELETE))?.onDelete).toBe('nullify');
  });
});

describe('every generated task and step shows in the builder like any other', () => {
  it("the creating task is in the parent's task inventory, named from the relation", () => {
    const rows = buildInventory(made(), 'eltern', 'de').tasks;
    expect(rows.find((r) => r.key === createTaskKey(REF))).toMatchObject({ label: 'Kinder anlegen' });
  });
  it('the delete task is the existing one, edited in place (its path is the one the builder shows)', () => {
    expect(buildInventory(made({ onDelete: 'cascade' }), 'eltern', 'de').tasks.map((r) => r.key)).toContain(
      'loeschen',
    );
  });
});

describe('the key of the creating task', () => {
  it('differs for every relation, also when parent and relation keys would read alike (property)', () => {
    expect(createTaskKey({ parent: 'a_b', key: 'c' })).not.toBe(createTaskKey({ parent: 'a', key: 'b_c' }));
    const key = fc.stringMatching(/^[a-z][a-z0-9_]{0,6}$/);
    fc.assert(
      fc.property(key, key, key, key, (p1, k1, p2, k2) => {
        fc.pre(p1 !== p2 || k1 !== k2);
        expect(createTaskKey({ parent: p1, key: k1 })).not.toBe(createTaskKey({ parent: p2, key: k2 }));
      }),
    );
  });
  it("an author's task under that key is refused, not adopted, and nothing is saved", () => {
    const base = open().apply({
      kind: 'add',
      path: `tasks.${createTaskKey(REF)}`,
      value: { label: { de: 'Meins' }, on: 'gutachten' },
    }).doc;
    const r = createRelation(base, NEW, 'de');
    expect(r).toMatchObject({ ok: false, code: 'key_clash', detail: createTaskKey(REF) });
  });
  it("a task of the same shape under that key is the relation's own and is kept", () => {
    const base = open().apply({
      kind: 'add',
      path: `tasks.${createTaskKey(REF)}`,
      value: { label: { de: 'Meins' }, on: 'eltern', creates: 'kind' },
    }).doc;
    const d = must(createRelation(base, NEW, 'de'));
    expect(tasks(d)[createTaskKey(REF)]?.label).toEqual({ de: 'Meins' });
  });
});

describe('re-saving, renaming, moving and removing', () => {
  it('saving the same options again changes nothing', () => {
    const a = made({ attachment: 'optional', onDelete: 'cascade' });
    const b = must(updateRelation(a, 'eltern.kinder', { attachment: 'optional', onDelete: 'cascade' }, 'de'));
    expect(b.save().overlaySrc).toBe(a.save().overlaySrc);
  });
  it('renaming renames the generated task label, a label the admin changed stays', () => {
    const a = made();
    const b = must(updateRelation(a, 'eltern.kinder', { name: 'Prüfungen' }, 'de'));
    expect(tasks(b)[createTaskKey(REF)]?.label).toEqual({ de: 'Prüfungen anlegen', en: 'Create Prüfungen' });
    const edited = a.apply({
      kind: 'set',
      path: `tasks.${createTaskKey(REF)}.label`,
      value: { de: 'Mein Name' },
    }).doc;
    const c = must(updateRelation(edited, 'eltern.kinder', { name: 'Prüfungen' }, 'de'));
    expect(tasks(c)[createTaskKey(REF)]?.label).toEqual({ de: 'Mein Name' });
  });
  it('moving the relation to another child moves the generated entries with their options', () => {
    const a = made({ attachment: 'enforced', onDelete: 'cascade' });
    const b = must(updateRelation(a, 'eltern.kinder', { child: 'gutachten' }, 'de'));
    const t = tasks(b);
    expect(t[createTaskKey(REF)]).toMatchObject({
      creates: 'gutachten',
      then: [{ set: { eltern: 'self' } }],
    });
    expect(t['loeschen']?.then?.filter((s) => s.of !== undefined)).toEqual([
      { lifecycle: 'deleted', of: 'self.kinder' },
    ]);
    expect(b.effective().types?.['gutachten']?.properties['eltern']?.required).toBe(true);
    expect(b.effective().types?.['kind']?.properties['eltern']).toBeUndefined();
    expect(entry(b)).toMatchObject({ child: 'gutachten', attachment: 'enforced', onDelete: 'cascade' });
  });
  it('deleting the relation takes every generated entry with it and leaves no new problem', () => {
    const base = open();
    const gone = deleteRelation(made({ onDelete: 'block' }), 'eltern.kinder');
    if ('refused' in gone) throw new Error(gone.refused);
    expect(tasks(gone.doc)[createTaskKey(REF)]).toBeUndefined();
    expect(tasks(gone.doc)['loeschen']).toEqual(tasks(base)['loeschen']);
    expect(gone.uses).toEqual([]);
    expect(gone.doc.problems().length).toBe(base.problems().length);
  });
  it('deleting a relation the draft added leaves the overlay as it was (the publish bar goes away)', () => {
    for (const onDelete of ['cascade', 'nullify', 'block'] as const) {
      const gone = deleteRelation(made({ onDelete }), 'eltern.kinder');
      if ('refused' in gone) throw new Error(gone.refused);
      expect(gone.doc.save().overlaySrc).toBe(open().save().overlaySrc);
      // also when the options added the parent's delete task themselves
      const bare = deleteRelation(made({ onDelete }, NO_DELETE), 'eltern.kinder');
      if ('refused' in bare) throw new Error(bare.refused);
      expect(bare.doc.save().overlaySrc).toBe(open(NO_DELETE).save().overlaySrc);
    }
  });
  it('creating adds no compile problem', () => {
    const base = open().problems().length;
    for (const attachment of ['enforced', 'optional'] as const)
      for (const onDelete of ['cascade', 'nullify', 'block'] as const)
        expect(made({ attachment, onDelete }).problems().length).toBe(base);
  });
});

describe('what the project does (core.plan through the simulator)', () => {
  const boss: Actor = { id: 'b', kind: 'participant', roles: ['boss' as Key] };
  const worker: Actor = { id: 'w', kind: 'participant', roles: ['worker' as Key] };
  function world(d: Doc, children = 2) {
    const opened = openSimulation(d.effective());
    if (!opened.ok) throw new Error(JSON.stringify(opened.problems));
    const sim = opened.simulation;
    const [parent] = sim.seed([{ type: 'eltern' as Key, properties: { name: 'p' } }]) as [FeatureId];
    const kids = sim.seed(
      Array.from({ length: children }, (_, i) => ({
        type: 'kind' as Key,
        properties: { name: `k${i}`, eltern: parent as never },
      })),
    );
    return { sim, parent, kids };
  }
  const life = (w: ReturnType<typeof world>, id: FeatureId) => w.sim.feature(id)?.lifecycle;

  it('mitlöschen: deleting the parent deletes its children, in one run', () => {
    const w = world(made({ onDelete: 'cascade' }));
    const r = w.sim.submit({ task: 'loeschen' as Key, actor: boss, feature: w.parent });
    expect(r.ok).toBe(true);
    expect([w.parent, ...w.kids].map((id) => life(w, id))).toEqual(['deleted', 'deleted', 'deleted']);
    expect(r.ok && r.runs).toHaveLength(1);
  });
  it('trennen: the children stay and lose their parent', () => {
    const w = world(made({ onDelete: 'nullify' }));
    expect(w.sim.submit({ task: 'loeschen' as Key, actor: boss, feature: w.parent }).ok).toBe(true);
    expect(life(w, w.parent)).toBe('deleted');
    for (const k of w.kids) {
      expect(life(w, k)).toBe('active');
      expect(w.sim.feature(k)?.properties['eltern']).toBeNull();
    }
  });
  it('blockieren: refused while children exist, with a reason; allowed without', () => {
    const d = made({ onDelete: 'block' });
    const w = world(d);
    const r = w.sim.submit({ task: 'loeschen' as Key, actor: boss, feature: w.parent });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.message.length).toBeGreaterThan(0);
    expect(life(w, w.parent)).toBe('active');
    const empty = world(d, 0);
    expect(empty.sim.submit({ task: 'loeschen' as Key, actor: boss, feature: empty.parent }).ok).toBe(true);
  });
  it('a child the actor may not write refuses the whole trennen run (nothing changes)', () => {
    const w = world(made({ onDelete: 'nullify' }));
    // the worker may delete a parent but not write a child (kind.permissions.write: [boss])
    const r = w.sim.submit({ task: 'loeschen' as Key, actor: worker, feature: w.parent });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('not_permitted');
    expect(life(w, w.parent)).toBe('active');
    for (const k of w.kids) expect(w.sim.feature(k)?.properties['eltern']).toBe(w.parent);
  });
  it('a child the actor may not delete refuses the whole mitlöschen run (nothing changes)', () => {
    const w = world(made({ onDelete: 'cascade' }));
    const r = w.sim.submit({ task: 'loeschen' as Key, actor: worker, feature: w.parent });
    expect(r.ok).toBe(false);
    expect([w.parent, ...w.kids].map((id) => life(w, id))).toEqual(['active', 'active', 'active']);
  });
  it('Anbindung: the creating task makes a child bound to its parent', () => {
    const w = world(made({ attachment: 'enforced' }), 0);
    const r = w.sim.submit({ task: createTaskKey(REF) as Key, actor: boss, feature: w.parent });
    expect(r.ok).toBe(true);
    const created = r.ok ? r.runs[0]?.created[0] : undefined;
    expect(w.sim.feature(created as FeatureId)).toMatchObject({ type: 'kind' });
    expect(w.sim.feature(created as FeatureId)?.properties['eltern']).toBe(w.parent);
  });
  it('Verbindlich: a child cannot be created without a parent; Optional can', () => {
    const alone = (d: Doc) => world(d, 0).sim.submit({ task: 'kind_neu' as Key, actor: boss });
    const enforced = alone(made({ attachment: 'enforced' }));
    expect(enforced.ok).toBe(false);
    if (!enforced.ok) expect(enforced.refusal.code).toBe('required_missing');
    expect(alone(made({ attachment: 'optional' })).ok).toBe(true);
  });
});
