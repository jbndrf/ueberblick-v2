// WP-377, C-004: the action pane's edits of an automatic action as Doc ops, one test per acceptance box that is a pure edit.
import { describe, expect, it } from 'vitest';
import { processesOf } from '@ueberblick/core';
import { openProject, type Doc, type Op } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { conditionOps, createRuleOps, deleteOps, labelOps, triggerOps } from './ops';
import { autoAt, autoOf, ownsTask } from './auto-task';
import { readRule, writeTrigger, type Trigger, type TriggerEnv } from './trigger';

const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const stage = processesOf(open().effective().types?.['baum'] as never)[0]?.property;
const env: TriggerEnv = { type: 'baum', stage };
/** The template's automatic action on `massnahme_anlegen`, which people also run. */
const SHARED = 'massnahme_anlegen.massnahme_bei_schaden';

function applyAll(doc: Doc, ops: readonly Op[]): Doc {
  let cur = doc;
  for (const op of ops) {
    const r = cur.apply(op);
    expect(r.refused, JSON.stringify([op, r.refused])).toBeUndefined();
    cur = r.doc;
  }
  return cur;
}

const entryOf = (doc: Doc, rule: string) => autoOf(doc.effective(), rule)?.entry;

function created(): { doc: Doc; rule: string; task: string } {
  const doc = open();
  const made = createRuleOps(doc.effective(), env, 'de', { rule: 'Neue Regel' });
  const next = applyAll(doc, made.ops);
  const rule = made.select.id ?? '';
  return { doc: next, rule, task: autoOf(next.effective(), rule)?.task ?? '' };
}

describe('"Aktion hinzufügen → Automatisch"', () => {
  it('creates a valid automatic action with v3 default trigger on a task only the system runs', () => {
    const before = open();
    const { doc, rule, task } = created();
    expect(doc.problems()).toEqual(before.problems());
    const file = doc.effective();
    expect(entryOf(doc, rule)?.after).toBe('erfassen'); // v3: on_create, the entry task
    expect(file.tasks?.[task]).toMatchObject({ on: 'baum' });
    expect(file.tasks?.[task]?.who).toBeUndefined(); // no `who`: only the system runs it
    expect(file.tasks?.[task]?.label).toEqual({ de: 'Neue Regel' });
    expect(Object.keys(file.tasks?.[task]?.auto ?? {})).toHaveLength(1);
    expect(ownsTask(file, rule)).toBe(true);
  });

  it('keys stay unique when added twice', () => {
    const first = created();
    const made = createRuleOps(first.doc.effective(), env, 'de', { rule: 'Neue Regel' });
    expect(made.select.id).not.toBe(first.rule);
    const doc = applyAll(first.doc, made.ops);
    expect(doc.problems()).toEqual(first.doc.problems());
  });
});

const TRIGGERS: readonly Trigger[] = [
  { kind: 'create', task: 'erfassen' },
  { kind: 'task', task: 'kontrolle' },
  { kind: 'transition', from: '', to: '' },
  { kind: 'change', properties: [], stage: '' },
  { kind: 'change', properties: ['vitalitaet'], stage: '' },
  { kind: 'elapsed', since: 'created', amount: 7, unit: 'days', stage: '' },
  { kind: 'elapsed', since: 'changed', amount: 2, unit: 'months', stage: '' },
  { kind: 'elapsed', since: 'changed', amount: 6, unit: 'hours', stage: '' },
  { kind: 'elapsed', since: 'entered', amount: 3, unit: 'days', stage: '' },
  { kind: 'when', condition: 'self.hoehe_m > 3' },
  { kind: 'schedule', cron: '0 2 * * *', idle: 7 },
];

describe('the Auslöser', () => {
  it.each(TRIGGERS)('writes %j and reads it back, with exactly one timing', (tr) => {
    const { doc, rule } = created();
    const ops = triggerOps(doc, rule, tr, env);
    expect(ops).toBeDefined();
    const next = applyAll(doc, ops ?? []);
    const entry = entryOf(next, rule);
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(readRule(next.effective(), entry, env).trigger).toEqual(tr);
    const timings = ['after', 'change', 'elapsed', 'schedule'].filter((k) => k in entry);
    expect(timings.length).toBeLessThanOrEqual(1);
  });

  it('a transition and several fields write generated when parts that read back', () => {
    const { doc, rule } = created();
    const options = Object.keys(
      (open().effective().types?.['baum']?.properties[stage ?? ''] as { options?: object }).options ?? {},
    );
    const [from, to] = options as [string, string];
    const tr: Trigger = { kind: 'transition', from, to };
    const w = writeTrigger(tr, env);
    expect(w?.leaves).toEqual([`previous('${stage}') == '${from}'`, `self.${stage} == '${to}'`]);
    const next = applyAll(doc, triggerOps(doc, rule, tr, env) ?? []);
    expect(entryOf(next, rule)?.when).toBe(`${w?.leaves[0]} && ${w?.leaves[1]}`);
    const many: Trigger = { kind: 'change', properties: ['a', 'b'], stage: '' };
    expect(writeTrigger(many, env)).toEqual({
      timing: { change: 'baum.*' },
      leaves: [`changed('a') || changed('b')`],
    });
  });

  it('changing the trigger keeps the rows of the Bedingung', () => {
    const { doc, rule } = created();
    let cur = applyAll(doc, conditionOps(doc, rule, 'self.hoehe > 3', env));
    expect(entryOf(cur, rule)?.when).toBe('self.hoehe > 3');
    cur = applyAll(
      cur,
      triggerOps(cur, rule, { kind: 'change', properties: ['a', 'b'], stage: '' }, env) ?? [],
    );
    expect(entryOf(cur, rule)?.when).toBe("(changed('a') || changed('b')) && self.hoehe > 3");
    const entry = entryOf(cur, rule);
    const reading = readRule(cur.effective(), entry as never, env);
    expect(reading.rest).toBe('self.hoehe > 3');
    expect(reading.trigger).toEqual({ kind: 'change', properties: ['a', 'b'], stage: '' });
    cur = applyAll(cur, conditionOps(cur, rule, '', env));
    expect(entryOf(cur, rule)?.when).toBe("changed('a') || changed('b')");
  });

  it('a hand-written elapsed timing reads as no picker kind and is not touched by the rows', () => {
    const file = open().effective();
    const entry = { elapsed: { from: 'self.faellig_am', offset: '-days(14)' } };
    expect(readRule(file, entry as never, env).trigger).toBeUndefined();
  });

  it('a condition edit never overwrites a timing the picker cannot say', () => {
    const { doc, rule } = created();
    const elapsed = { from: 'self.faellig_am', offset: '-days(14)' };
    const hand = applyAll(doc, [
      { kind: 'set', path: autoAt(rule), value: { label: { de: 'x' }, elapsed } } as Op,
    ]);
    const cur = applyAll(hand, conditionOps(hand, rule, 'self.hoehe > 3', env));
    expect(entryOf(cur, rule)?.elapsed).toEqual(elapsed);
    expect(entryOf(cur, rule)?.when).toBe('self.hoehe > 3');
  });

  it('an edge trigger is one condition: the rows go into it, and it has no rows of its own', () => {
    const { doc, rule } = created();
    let cur = applyAll(doc, conditionOps(doc, rule, 'self.hoehe_m > 3', env));
    cur = applyAll(
      cur,
      triggerOps(cur, rule, { kind: 'when', condition: 'self.stage_x != null' }, env) ?? [],
    );
    const entry = entryOf(cur, rule);
    expect(entry?.after).toBeUndefined();
    expect(entry?.when).toBe('self.stage_x != null && self.hoehe_m > 3');
    const reading = readRule(cur.effective(), entry as never, env);
    expect(reading.trigger).toEqual({ kind: 'when', condition: 'self.stage_x != null && self.hoehe_m > 3' });
    expect(reading.rest).toBeUndefined();
    expect(conditionOps(cur, rule, 'self.a > 1', env)).toEqual([]);
  });
});

describe('ownership of the task', () => {
  it('a template action on a task people also run does not own it', () => {
    expect(ownsTask(open().effective(), SHARED)).toBe(false);
  });
});

describe('name and delete', () => {
  it('the name goes to the entry and to its own task; empty text changes nothing', () => {
    const { doc, rule, task } = created();
    expect(labelOps(doc, rule, 'de', '  ')).toEqual([]);
    const next = applyAll(doc, labelOps(doc, rule, 'de', 'Jährlich prüfen'));
    expect(entryOf(next, rule)?.label).toEqual({ de: 'Jährlich prüfen' });
    expect(next.effective().tasks?.[task]?.label).toEqual({ de: 'Jährlich prüfen' });
  });

  it('deleting takes the action and the task it owns; on a shared task only the entry goes', () => {
    const { doc, rule, task } = created();
    const gone = applyAll(doc, deleteOps(doc, rule));
    expect(gone.effective().tasks?.[task]).toBeUndefined();
    const shared = open();
    const after = applyAll(shared, deleteOps(shared, SHARED));
    expect(entryOf(after, SHARED)).toBeUndefined();
    expect(after.effective().tasks?.['massnahme_anlegen']).toBeDefined();
    expect(after.overlay().hide).toContain('tasks.massnahme_anlegen.auto.massnahme_bei_schaden');
  });

  it('the task it owns can be taken out although an overlay `order` lists it (after a canvas reorder)', () => {
    const { doc, rule, task } = created();
    const keys = Object.keys(doc.effective().tasks ?? {});
    const ordered = applyAll(doc, [{ kind: 'order', path: 'tasks', keys: [...keys].reverse() }]);
    const gone = applyAll(ordered, deleteOps(ordered, rule));
    expect(gone.effective().tasks?.[task]).toBeUndefined();
    expect(gone.overlay().order?.['tasks']).not.toContain(task);
  });
});
