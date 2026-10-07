// C-004 step 3: `who` on a task, the one shared `when`, automatic runs without a form.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { Actor, FeatureId, Key, Run } from '../model';
import { compilePerms, whoAdmits } from '../perms';
import { createPlan, oneVersion } from './index';
import type { PlanResult } from './contract';
import { World, actor, buildRaw, fid, ports, rid, rulePorts } from './__fixtures__/world';

const api = createPlan(formApi);
const anna = actor('participant', 'anna', ['worker']);
const other = actor('participant', 'otto', ['guest']);
const boss = actor('admin', 'root');
const POINT = { type: 'Point', coordinates: [1, 1] };

const file = {
  schema: 'ueberblick/1',
  template: { key: 'who', version: '1.0.0' },
  roles: { worker: { label: 'Worker' }, guest: { label: 'Guest' } },
  types: {
    fall: {
      label: 'Fall',
      geometry: 'geom',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: {
        geom: { type: 'geometry', geometry_type: 'point' },
        status: { type: 'text', default: 'offen' },
        who: { type: 'text' },
        due: { type: 'date' },
      },
    },
  },
  tasks: {
    open: { label: 'Open', on: 'fall', who: ['worker'], then: [{ set: { status: "'x'" } }] },
    by_admin: { label: 'By admin', on: 'fall', who: ['admin'], then: [{ set: { status: "'a'" } }] },
    nobody: { label: 'Nobody', on: 'fall', then: [{ set: { status: "'n'" } }] },
    guarded: {
      label: 'Guarded',
      on: 'fall',
      who: ['worker'],
      when: "self.status == 'offen'",
      then: [{ set: { status: "'g'" } }],
    },
    // automatic only: no `who`; the required field is covered by `then.set`
    assign: {
      label: 'Assign',
      on: 'fall',
      when: "self.status == 'offen'",
      form: { who: { required: true } },
      then: [{ set: { who: "form.who != null ? form.who : 'system'" } }],
      auto: { late: { elapsed: { from: 'self.due' } } },
    },
    // pressed by workers and run automatically after `open`
    both: {
      label: 'Both',
      on: 'fall',
      who: ['worker'],
      then: [{ set: { status: "'both'" } }],
      auto: { after_open: { after: 'open' } },
    },
  },
};

const config = buildRaw(file);
const perms = compilePerms(config);

function setup() {
  const w = new World(config);
  w.add(fid(1), 'fall', { geom: POINT, status: 'offen', due: '2026-01-01' });
  return { w, p: ports(w) };
}
let n = 0;
const run = (task: string, who: Actor, input: Record<string, never> = {}): Run => ({
  id: rid(++n),
  task: task as Key,
  actor: who,
  configVersion: 1,
  input,
  featureId: fid(1),
});
const plan = (r: Run): PlanResult => {
  const { p } = setup();
  return api.planFor([r], oneVersion(config, perms), p);
};
const refusal = (r: PlanResult) => (r.ok ? undefined : r.refusal);

describe('who: no who means no person', () => {
  it('a participant with a role of `who` may run the task; another role and no role may not', () => {
    expect(plan(run('open', anna)).ok).toBe(true);
    expect(refusal(plan(run('open', other)))).toMatchObject({ code: 'not_permitted', path: 'who' });
    expect(refusal(plan(run('open', actor('participant', 'x', []))))).toMatchObject({ path: 'who' });
  });

  it('a task without `who` is refused for a participant and for an admin', () => {
    expect(refusal(plan(run('nobody', anna)))).toMatchObject({ code: 'not_permitted', path: 'who' });
    expect(refusal(plan(run('nobody', boss)))).toMatchObject({ code: 'not_permitted', path: 'who' });
  });

  it('`admin` admits an admin account and no participant of another role', () => {
    expect(plan(run('by_admin', boss)).ok).toBe(true);
    expect(refusal(plan(run('by_admin', anna)))?.path).toBe('who');
    expect(refusal(plan(run('open', boss)))?.path).toBe('who');
    // an admin account with the role of the task is admitted by the role
    expect(plan(run('open', actor('admin', 'a', ['worker']))).ok).toBe(true);
  });

  it('availableFor agrees with plan (one implementation)', () => {
    const { p } = setup();
    const a = api.availableFor('nobody' as Key, { feature: fid(1) }, anna, oneVersion(config, perms), p);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.refusal).toEqual(refusal(plan(run('nobody', anna))));
    expect(api.availableTasksFor(fid(1), anna, oneVersion(config, perms), p)).toEqual([
      'open',
      'guarded',
      'both',
    ]);
    expect(api.availableTasksFor(fid(1), boss, oneVersion(config, perms), p)).toEqual(['by_admin']);
  });

  it('property: whoAdmits by actor kind x who shape x cause', () => {
    const roles = ['a', 'b', 'c'];
    fc.assert(
      fc.property(
        fc.subarray([...roles, 'admin', 'import']),
        fc.subarray(roles),
        fc.boolean(),
        fc.boolean(),
        (who, mine, withAuto, own) => {
          const task = { who, ...(withAuto ? { auto: { x: {} } } : {}) };
          const noWho = { ...(withAuto ? { auto: { x: {} } } : {}) };
          const p = actor('participant', 'p', mine);
          expect(whoAdmits(task, p)).toBe(mine.some((r) => who.includes(r)));
          expect(whoAdmits(task, boss)).toBe(who.includes('admin'));
          expect(whoAdmits(task, actor('admin', 'a', mine))).toBe(
            who.includes('admin') || mine.some((r) => who.includes(r)),
          );
          // no `who`: no person
          expect(whoAdmits(noWho, p)).toBe(false);
          expect(whoAdmits(noWho, boss)).toBe(false);
          // the system skips `who` only for the run of one of the task's own auto entries (`own`)
          const sys = actor('system', 'system');
          expect(whoAdmits(task, sys, own)).toBe(own && withAuto);
          expect(whoAdmits(noWho, sys, own)).toBe(own && withAuto);
          expect(whoAdmits(task, sys)).toBe(false);
          // an import needs `import` or a held role in `who`; a task without `who` refuses it
          expect(whoAdmits(noWho, actor('import', 'csv'))).toBe(false);
          expect(whoAdmits(noWho, actor('import', 'csv', mine))).toBe(false);
          expect(whoAdmits(task, actor('import', 'csv'))).toBe(who.includes('import'));
          expect(whoAdmits(task, actor('import', 'csv', mine))).toBe(
            who.includes('import') || mine.some((r) => who.includes(r)),
          );
        },
      ),
    );
  });

  it("plan: a system run is admitted only as the run of the task's own auto entry", () => {
    const sys = actor('system', 'system');
    // `both` has `who` and its own entry `after_open`; `assign` has `late`; `open` has no auto entry
    expect(plan({ ...run('both', sys), auto: 'both.after_open' as Key }).ok).toBe(true);
    expect(refusal(plan(run('both', sys)))).toMatchObject({ code: 'not_permitted', path: 'who' });
    // an entry of another task is not its own
    expect(refusal(plan({ ...run('both', sys), auto: 'assign.late' as Key }))).toMatchObject({ path: 'who' });
    expect(refusal(plan({ ...run('open', sys), auto: 'both.after_open' as Key }))).toMatchObject({
      path: 'who',
    });
    expect(refusal(plan({ ...run('open', sys), auto: 'nope' as Key }))).toMatchObject({ path: 'who' });
  });

  it('plan: an import needs `import` or a held role in `who`; a task without `who` refuses it', () => {
    expect(refusal(plan(run('nobody', actor('import', 'csv', ['worker']))))).toMatchObject({ path: 'who' });
    expect(refusal(plan(run('open', actor('import', 'csv'))))).toMatchObject({ path: 'who' });
    expect(plan(run('open', actor('import', 'csv', ['worker']))).ok).toBe(true);
  });
});

describe('the shared when applies to every run', () => {
  it('a person is refused while the shared `when` is false', () => {
    const { w, p } = setup();
    w.add(fid(2), 'fall', { geom: POINT, status: 'zu' });
    const r = api.planFor([{ ...run('guarded', anna), featureId: fid(2) }], oneVersion(config, perms), p);
    expect(refusal(r)).toMatchObject({ code: 'not_available', path: 'when' });
    expect(plan(run('guarded', anna)).ok).toBe(true);
  });

  it('an automatic run is refused while the shared `when` is false, and runs while it holds', () => {
    const { w } = setup();
    w.add(fid(2), 'fall', { geom: POINT, status: 'zu', due: '2026-01-01' });
    const p = rulePorts(w);
    const fire = (subject: FeatureId) =>
      api.fireRuleFor(
        { rule: 'assign.late' as Key, subject, configVersion: 1, dueAt: '2026-01-02T00:00:00Z' },
        oneVersion(config, perms),
        p,
      );
    const closed = fire(fid(2));
    expect(!closed.ok && closed.refusal).toMatchObject({ code: 'not_available' });
    expect(fire(fid(1)).ok).toBe(true);
  });
});

describe('an automatic run skips who and has no form', () => {
  it('a task without `who` runs automatically: its `then.set` gives the required value', () => {
    const { w } = setup();
    const r = api.fireRuleFor(
      { rule: 'assign.late' as Key, subject: fid(1), configVersion: 1, dueAt: '2026-01-02T00:00:00Z' },
      oneVersion(config, perms),
      rulePorts(w),
    );
    if (!r.ok) throw new Error(r.refusal.message);
    const flat = Object.fromEntries(r.runs[0]?.observations.map((o) => [o.property, o.result]) ?? []);
    expect(flat).toEqual({ who: 'system' });
    expect(r.runs[0]?.run.actor.kind).toBe('system');
  });

  it('a task with both is pressed by its roles and also runs after its trigger', () => {
    const r = plan(run('open', anna));
    if (!r.ok) throw new Error(r.refusal.message);
    expect(r.runs.map((x) => x.run.task)).toEqual(['open', 'both']);
    expect(r.runs[1]?.run.actor.kind).toBe('system');
    expect(plan(run('both', anna)).ok).toBe(true);
    expect(refusal(plan(run('both', other)))?.path).toBe('who');
  });

  it('a system run carries no input: it has no form', () => {
    const sys = actor('system', 'system');
    expect(
      refusal(plan({ ...run('assign', sys, { who: 'x' as never }), auto: 'assign.late' as Key })),
    ).toMatchObject({
      code: 'invalid_input',
    });
    expect(plan({ ...run('assign', sys), auto: 'assign.late' as Key }).ok).toBe(true);
  });

  it('a person submitting the same task fills the field; `then.set` keeps their value', () => {
    const r = plan(run('assign', anna));
    expect(refusal(r)?.path).toBe('who');
    const boss2 = { ...file, tasks: { ...file.tasks, assign: { ...file.tasks.assign, who: ['worker'] } } };
    const c2 = buildRaw(boss2);
    const { p } = setup();
    const done = api.planFor(
      [run('assign', anna, { who: 'anna' as never })],
      oneVersion(c2, compilePerms(c2)),
      p,
    );
    if (!done.ok) throw new Error(done.refusal.message);
    const last = done.runs[0]?.observations.filter((o) => o.property === 'who').at(-1);
    expect(last?.result).toBe('anna');
  });
});

describe('an automatic action without a timing is an edge of the shared when', () => {
  const edgeFile = {
    ...file,
    types: {
      fall: {
        ...file.types.fall,
        properties: {
          ...file.types.fall.properties,
          n: { type: 'number', default: 0 },
          seen: { type: 'boolean' },
        },
      },
    },
    tasks: {
      setze: { label: 'Setze', on: 'fall', who: ['worker'], form: { n: {} } },
      markiere: {
        label: 'Markiere',
        on: 'fall',
        when: 'self.n > 5 && self.seen != true',
        then: [{ set: { seen: 'true' } }],
        auto: { ueber: {} },
      },
    },
  };
  const edge = buildRaw(edgeFile);
  const set = (value: number): PlanResult => {
    const w = new World(edge);
    w.add(fid(1), 'fall', { geom: POINT, n: 0 });
    return api.planFor(
      [{ ...run('setze', anna), input: { n: value } as never }],
      oneVersion(edge, compilePerms(edge)),
      ports(w),
    );
  };

  it('fires when a run turns the shared `when` true, and not while it stays false', () => {
    const hit = set(9);
    if (!hit.ok) throw new Error(hit.refusal.message);
    expect(hit.runs.map((r) => r.run.task)).toEqual(['setze', 'markiere']);
    const miss = set(2);
    if (!miss.ok) throw new Error(miss.refusal.message);
    expect(miss.runs.map((r) => r.run.task)).toEqual(['setze']);
  });
});
