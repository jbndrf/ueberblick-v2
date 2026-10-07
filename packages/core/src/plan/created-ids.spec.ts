// WP-748: the ids a plan creates are a pure function of the submitted run, so a device and a server that plan the
// same run (alone, in another batch, with other id ports) agree on every created feature and rule run.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { Json, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { createPlan, oneVersion } from './index';
import type { PlannedRun } from './contract';
import { IDS, anna, fid, musterstadt, ports, rid } from './__fixtures__/world';
import { seededIds } from './seeded-ids';

const planApi = createPlan(formApi);
const env = musterstadt();
const perms = compilePerms(env.config);

/** A kontrolle that makes the rule create a measure, and an erfassen that creates a baum (no id given). */
const kontrolle = (n: number): Run =>
  ({
    id: rid(n),
    task: 'kontrolle' as Key,
    actor: anna,
    configVersion: 1,
    featureId: IDS.t_in,
    input: {
      vitalitaet: 'v4',
      befund: 'Pilz',
      foto: [{ sha256: 'aa11', name: 's.jpg', mime: 'image/jpeg' }],
    },
  }) as Run;
const erfassen = (n: number): Run =>
  ({
    id: rid(n),
    task: 'erfassen' as Key,
    actor: anna,
    configVersion: 1,
    input: { geometrie: { type: 'Point', coordinates: [7.1015, 50.7315] }, vitalitaet: 'v1' } as Record<
      string,
      Json
    >,
  }) as Run;

/** Plans `batch` with an id port that counts from `start` (a device and a server mint different ones). */
function plan(batch: readonly Run[], start: number): readonly PlannedRun[] {
  const p = ports(env.world);
  p.counter.n = start;
  const r = planApi.planFor(batch, oneVersion(env.config, perms), p);
  if (!r.ok) throw new Error(JSON.stringify(r.refusal));
  return r.runs;
}
const idsOf = (runs: readonly PlannedRun[], runId: string): readonly string[] =>
  runs.filter((p) => p.run.id === runId || p.run.causedBy === runId).flatMap((p) => [p.run.id, ...p.created]);

describe('ids a plan creates', () => {
  it('a created feature and a rule run keep their ids under other id ports and other batches', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 900 }), fc.integer({ min: 2000, max: 9000 }), (a, b) => {
        const r1 = kontrolle(10);
        const r2 = erfassen(11);
        const device = plan([r1, r2], a);
        const server = plan([r2], b);
        const serverFirst = plan([r1], b + 5);
        expect(idsOf(server, r2.id)).toEqual(idsOf(device, r2.id));
        expect(idsOf(serverFirst, r1.id)).toEqual(idsOf(device, r1.id));
        expect(idsOf(device, r2.id).length).toBeGreaterThan(1);
        expect(idsOf(device, r1.id).length).toBeGreaterThan(2); // run, rule run, measure
      }),
      { numRuns: 20 },
    );
  });

  it('ids are those of seededIds(run.id): the measure is the first feature, the rule run the first run', () => {
    const r1 = kontrolle(10);
    const runs = plan([r1], 1);
    const s = seededIds(r1.id);
    const rule = runs.find((p) => p.run.causedBy === r1.id) as PlannedRun;
    expect(rule.run.id).toBe(s.runId());
    expect(rule.created).toEqual([s.featureId()]);
    expect(fid(1)).not.toBe(rule.created[0]);
  });
});
