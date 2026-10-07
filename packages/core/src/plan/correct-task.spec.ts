// WP-370: the built-in `$correct` task ('Admin-Korrektur'): an admin corrects any property of one Objekt but the stage.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { Actor, FeatureId, Json, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { CORRECT_TASK } from '../registry';
import { SYSTEM_TASKS } from '../registry/admin';
import { computedFile } from '../schema/compile/__fixtures__/computed';
import type { PlanResult } from './contract';
import { createPlan, oneVersion } from './index';
import { addAuto } from './__fixtures__/auto';
import { IDS, World, actor, anna, build, fid, musterstadt, ports, rid } from './__fixtures__/world';

const ADMIN: Actor = actor('admin', 'root');
const planApi = createPlan(formApi);

const correct = (values: Json, who: Actor = ADMIN, id: FeatureId | undefined = IDS.t_in): Run => ({
  id: rid(50),
  task: CORRECT_TASK as Key,
  actor: who,
  configVersion: 1,
  ...(id === undefined ? {} : { featureId: id }),
  input: { values },
});

function planTree(run: Run): PlanResult {
  const { config, world } = musterstadt();
  return planApi.planFor([run], oneVersion(config, compilePerms(config)), ports(world));
}
const refusalOf = (r: PlanResult) => {
  if (r.ok) throw new Error('planned');
  return r.refusal;
};
const written = (r: PlanResult) => {
  if (!r.ok) throw new Error(r.refusal.message);
  return Object.fromEntries((r.runs[0]?.observations ?? []).map((o) => [o.property, o.result]));
};

describe('$correct', () => {
  it('is in the registry with both labels', () => {
    const e = SYSTEM_TASKS.get(CORRECT_TASK);
    expect(e.description_de).toContain('Admin-Korrektur');
    expect(e.description).toContain('Admin correction');
  });

  it('writes valid values on any property but the stage, as one run on the feature', () => {
    const r = planTree(correct({ befund: 'Pilzbefall', hoehe_m: 12, vitalitaet: 'v3' }));
    expect(written(r)).toEqual({ befund: 'Pilzbefall', hoehe_m: 12, vitalitaet: 'v3' });
    if (r.ok) {
      expect(r.runs).toHaveLength(1);
      expect(r.runs[0]?.run.task).toBe(CORRECT_TASK);
      expect(r.runs[0]?.created).toEqual([]);
      expect(r.runs[0]?.observations.every((o) => o.featureId === IDS.t_in)).toBe(true);
    }
  });

  it('clears a property with an explicit null and writes nothing for an unchanged value', () => {
    const r = planTree(correct({ befund: '', vitalitaet: 'v2' }));
    expect(written(r)).toEqual({ befund: null });
  });

  it.each([
    ['the stage', { stage: 'massnahme' }, 'not_permitted', 'input.values.stage'],
    ['a system key', { $lifecycle: 'deleted' }, 'invalid_input', 'input.values.$lifecycle'],
    ['an unknown property', { gibtsnicht: 1 }, 'invalid_input', 'input.values.gibtsnicht'],
    ['a type mismatch', { hoehe_m: 'hoch' }, 'invalid_input', 'input.values.hoehe_m'],
    ['a select value that is no option', { vitalitaet: 'v9' }, 'invalid_input', 'input.values.vitalitaet'],
  ])('refuses %s with the path of the bad value', (_n, values, code, path) => {
    const r = refusalOf(planTree(correct({ befund: 'ok', ...values })));
    expect(r.code).toBe(code);
    expect(r.path).toBe(path);
  });

  it('refuses a participant and the system, an unknown feature, and a bad input', () => {
    expect(refusalOf(planTree(correct({ befund: 'x' }, anna))).code).toBe('not_permitted');
    expect(refusalOf(planTree(correct({ befund: 'x' }, actor('system', 'system')))).code).toBe(
      'not_permitted',
    );
    expect(refusalOf(planTree(correct({ befund: 'x' }, ADMIN, fid(99)))).code).toBe('unknown_feature');
    expect(refusalOf(planTree(correct({}))).code).toBe('invalid_input');
    expect(refusalOf(planTree(correct('nope'))).code).toBe('invalid_input');
  });

  it('property: any subset of valid values is written as exactly those that change, never the stage', () => {
    const pool: Record<string, Json[]> = {
      befund: ['a', 'b', 'unauffällig', ''],
      hoehe_m: [1, 12.5, 40],
      vitalitaet: ['v0', 'v1', 'v2', 'v3'],
      intern_notiz: ['x', 'Wurzelschaden prüfen'],
    };
    const current: Record<string, Json> = {
      befund: 'unauffällig',
      vitalitaet: 'v2',
      intern_notiz: 'Wurzelschaden prüfen',
    };
    fc.assert(
      fc.property(
        fc.dictionary(fc.constantFrom(...Object.keys(pool)), fc.nat(5), { minKeys: 1 }),
        (picks) => {
          const values = Object.fromEntries(
            Object.entries(picks).map(([k, n]) => [k, (pool[k] as Json[])[n % (pool[k] as Json[]).length]]),
          ) as Record<string, Json>;
          const r = planTree(correct(values));
          const out = written(r);
          expect(Object.keys(out)).not.toContain('stage');
          for (const [k, v] of Object.entries(values)) {
            const changed = v === '' ? current[k] !== undefined : current[k] !== v;
            expect(k in out).toBe(changed);
          }
        },
      ),
    );
  });

  it('checks expected_seq inside the plan: a stale one is refused, the current one passes', () => {
    const { config, world } = musterstadt();
    const seq = world.feature(IDS.t_in)?.updatedSeq as number;
    const planWith = (expected: Json) =>
      planApi.planFor(
        [{ ...correct({ befund: 'neu' }), input: { values: { befund: 'neu' }, expected_seq: expected } }],
        oneVersion(config, compilePerms(config)),
        ports(world),
      );
    const stale = refusalOf(planWith(seq - 1));
    expect(stale.code).toBe('not_available');
    expect(stale.path).toBe('input.expected_seq');
    expect(refusalOf(planWith('x')).code).toBe('invalid_input');
    expect(written(planWith(seq))).toEqual({ befund: 'neu' });
  });

  it('computed values and rules react as they do to any run', () => {
    const file = computedFile();
    // an automatic run has no form: the task's `then.set` writes the height
    const edit = (file['tasks'] as Record<string, Record<string, unknown>>)['edit'];
    if (edit === undefined) throw new Error('fixture has no edit task');
    edit['then'] = [{ set: { height: '7' } }];
    addAuto(file, 'edit', 'height_on_label', { change: 'parcel.label' });
    const config = build(file);
    const w = new World(config);
    w.add(IDS.t_in, 'parcel', { width: 4, height: 5, area: 20, size_class: 'small', label: 'a' });
    const r = planApi.planFor(
      [correct({ width: 30, label: 'b' })],
      oneVersion(config, compilePerms(config)),
      ports(w),
    );
    if (!r.ok) throw new Error(r.refusal.message);
    const first = Object.fromEntries(r.runs[0]?.observations.map((o) => [o.property, o.result]) ?? []);
    expect(first).toMatchObject({ width: 30, label: 'b', area: 150, size_class: 'large' });
    // the rule's run follows, caused by the correction
    expect(r.runs).toHaveLength(2);
    expect(r.runs[1]?.observations.map((o) => o.property)).toContain('height');
  });
});
