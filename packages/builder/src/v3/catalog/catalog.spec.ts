import { describe, expect, it } from 'vitest';
import { openProject } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { buildInventory, TASK_BADGES } from './inventory';
import { createOp, CREATE_REFUSALS, type NewNames } from './ops';

const names: NewNames = {
  task: 'Neue Aufgabe',
  entry: 'Neuer Eingang',
  stage: 'Neue Phase',
  rule: 'Neue Regel',
  process: 'Phase',
  endStage: 'Ende',
};
const open = () => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

describe('inventories', () => {
  it('list the tasks, rules and fields of the Objektart', () => {
    const inv = buildInventory(open(), 'baum', 'de');
    const keys = inv.tasks.map((t) => t.key);
    expect(keys).toContain('kontrolle');
    expect(keys).toContain('erfassen'); // an entry: on $map, creates baum
    expect(keys).not.toContain('flaeche_bearbeiten'); // belongs to flaeche
    expect(inv.tasks.find((t) => t.key === 'erfassen')?.badge).toBe(TASK_BADGES.entry);
    expect(inv.rules.map((r) => r.key)).toContain('massnahme_anlegen.massnahme_bei_schaden');
    expect(inv.fields.map((f) => f.key)).toContain('stage');
    expect(inv.hasProcess).toBe(true);
  });

  it('an automatic action without a timing shows as "edge" (WP-438)', () => {
    const doc = open().apply({
      kind: 'set',
      path: 'tasks.massnahme_anlegen.auto.massnahme_bei_schaden.when',
      value: 'self.hoehe_m > 3',
    }).doc;
    const row = buildInventory(
      doc.apply({ kind: 'hide', path: 'tasks.massnahme_anlegen.auto.massnahme_bei_schaden.after' }).doc,
      'baum',
      'de',
    ).rules.find((r) => r.key === 'massnahme_anlegen.massnahme_bei_schaden');
    expect(row?.trigger).toBe('edge');
  });

  it('another Objektart has its own lists, and no process when it declares none', () => {
    const inv = buildInventory(open(), 'flaeche', 'de');
    expect(inv.tasks.map((t) => t.key)).toContain('flaeche_bearbeiten');
    expect(inv.tasks.map((t) => t.key)).not.toContain('kontrolle');
    expect(inv.hasProcess).toBe(false);
  });
});

describe('createOp', () => {
  it.each(['button', 'form'] as const)('a %s task is added to the draft and selected', (task) => {
    const doc = open();
    const r = createOp(doc.effective(), 'baum', { kind: 'task', task }, 'de', names);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const applied = doc.apply(r.op);
    expect(applied.refused).toBeUndefined();
    expect(applied.problems).toEqual(doc.problems());
    const key = r.select.id ?? '';
    expect(r.select.kind).toBe('task');
    const added = applied.doc.effective().tasks?.[key];
    expect(added?.on).toBe('baum');
    expect(added?.form !== undefined).toBe(task === 'form');
    expect(applied.doc.provenance(`tasks.${key}`)).toBe('added');
  });

  it.each(['button', 'form'] as const)(
    'a new %s action is open to all role keys plus admin, never import',
    (task) => {
      const doc = open();
      const r = createOp(doc.effective(), 'baum', { kind: 'task', task }, 'de', names);
      if (!r.ok) throw new Error('refused');
      const added = doc.apply(r.op).doc.effective().tasks?.[r.select.id ?? ''];
      expect(added?.who).toEqual([...Object.keys(doc.effective().roles ?? {}), 'admin']);
      expect(added?.who).not.toContain('import');
    },
  );

  it('a new automatic action writes no who on its own task', () => {
    const doc = open();
    const r = createOp(doc.effective(), 'baum', { kind: 'node', node: 'rule' }, 'de', names);
    if (!r.ok) throw new Error('refused');
    expect(JSON.stringify([r.op, ...(r.after ?? [])])).not.toContain('"who"');
  });

  it('an entry is a task offered from the map that creates the Objektart', () => {
    const doc = open();
    const r = createOp(doc.effective(), 'baum', { kind: 'node', node: 'entry' }, 'de', names);
    if (!r.ok) throw new Error('refused');
    const t = doc.apply(r.op).doc.effective().tasks?.[r.select.id ?? ''];
    expect(t).toMatchObject({ on: '$map', creates: 'baum' });
    expect(t?.who).toEqual([...Object.keys(doc.effective().roles ?? {}), 'admin']);
  });

  it('keys stay unique when the same chip is used twice', () => {
    let doc = open();
    const keys = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const r = createOp(doc.effective(), 'baum', { kind: 'task', task: 'button' }, 'de', names);
      if (!r.ok) throw new Error('refused');
      keys.add(r.select.id ?? '');
      doc = doc.apply(r.op).doc;
    }
    expect(keys.size).toBe(3);
  });

  it('a stage on a type without a process creates the process as one undoable change (WP-508)', () => {
    const doc = open();
    const before = JSON.stringify(doc.effective());
    const r = createOp(doc.effective(), 'flaeche', { kind: 'node', node: 'stage' }, 'de', names);
    if (!r.ok) throw new Error('refused');
    const applied = doc.applyBatch([r.op, ...(r.after ?? [])]);
    if ('refused' in applied) throw new Error('refused');
    const t = applied.doc.effective().types?.['flaeche'];
    const prop = t?.process?.property ?? '';
    expect(t?.process).toEqual({ property: prop, start: r.select.id, end: ['ende'] });
    expect(t?.properties[prop]?.type).toBe('select');
    expect(Object.keys(t?.properties[prop]?.options ?? {})).toEqual([r.select.id, 'ende']);
    expect(r.select.kind).toBe('stage');
    // the only new problem: the end stage is not yet moved to by a task (as for any added stage)
    expect(
      applied.problems.filter((p) => !doc.problems().some((q) => q.path === p.path)).map((p) => p.code),
    ).toEqual(['dead_option']);
    // undo = keep the old Doc: one batch, the old file is untouched
    expect(JSON.stringify(doc.effective())).toBe(before);
  });

  it('an unknown type is refused', () => {
    const doc = open();
    expect(createOp(doc.effective(), 'gibtsnicht', { kind: 'node', node: 'stage' }, 'de', names)).toEqual({
      ok: false,
      reason: CREATE_REFUSALS.noProcess,
    });
    const r = createOp(doc.effective(), 'baum', { kind: 'node', node: 'stage' }, 'de', names);
    expect(r.ok && r.op.kind === 'add' ? r.op.path : '').toBe(
      'types.baum.properties.stage.options.neue_phase',
    );
  });
});
