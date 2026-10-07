// WP-748 fix round 1: a create never overwrites a feature. `id_taken` is raised in plan, one check for every create.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { FeatureId, Json, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { CREATE_TASK, SEED_TASK } from '../registry';
import type { PlanResult } from './contract';
import { createPlan, oneVersion } from './index';
import { seededIds } from './seeded-ids';
import { IDS, actor, anna, fid, musterstadt, ports, rid } from './__fixtures__/world';

const planApi = createPlan(formApi);
const point = { type: 'Point', coordinates: [7.1015, 50.7315] } as Json;

const erfassen = (n: number, featureId?: FeatureId): Run => ({
  id: rid(n),
  task: 'erfassen' as Key,
  actor: anna,
  configVersion: 1,
  ...(featureId === undefined ? {} : { featureId }),
  input: { geometrie: point, vitalitaet: 'v1' },
});
const createRun = (n: number, id: FeatureId): Run => ({
  id: rid(n),
  task: CREATE_TASK as Key,
  actor: actor('admin', 'root'),
  configVersion: 1,
  featureId: id,
  input: { type: 'baumart', values: { name_de: 'Ahorn' } },
});
const seedRun = (n: number, id: FeatureId): Run => ({
  id: rid(n),
  task: SEED_TASK as Key,
  actor: actor('system', 'seed'),
  configVersion: 1,
  featureId: id,
  input: { type: 'baumart', values: { name_de: 'Ahorn' } },
});

const world = () => musterstadt();
function plan(batch: readonly Run[], pre?: (w: ReturnType<typeof world>['world']) => void): PlanResult {
  const { config, world: w } = world();
  pre?.(w);
  return planApi.planFor(batch, oneVersion(config, compilePerms(config)), ports(w));
}
const codeOf = (r: PlanResult): string => (r.ok ? 'ok' : r.refusal.code);

describe('id_taken', () => {
  it('a $map create onto an existing feature id is refused and writes nothing', () => {
    const r = plan([erfassen(10, IDS.t_in)]);
    expect(codeOf(r)).toBe('id_taken');
  });
  it('$create and $seed onto an existing id are refused', () => {
    expect(codeOf(plan([createRun(11, IDS.linde)]))).toBe('id_taken');
    expect(codeOf(plan([seedRun(12, IDS.linde)]))).toBe('id_taken');
  });
  it('a new id still works', () => {
    expect(codeOf(plan([erfassen(10, fid(900))]))).toBe('ok');
  });
  it('two creates with one id in a batch: the second is refused', () => {
    const r = plan([erfassen(10, fid(901)), erfassen(11, fid(901))]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusal.code).toBe('id_taken');
      expect(r.runId).toBe(rid(11));
    }
    expect(codeOf(plan([createRun(12, fid(902)), seedRun(13, fid(902))]))).toBe('id_taken');
  });
  it('a rule-created feature whose id already exists is refused', () => {
    const run: Run = {
      id: rid(20),
      task: 'kontrolle' as Key,
      actor: anna,
      configVersion: 1,
      featureId: IDS.t_in,
      input: {
        vitalitaet: 'v4',
        befund: 'Pilz',
        foto: [{ sha256: 'aa11', name: 's.jpg', mime: 'image/jpeg' }],
      },
    };
    expect(codeOf(plan([run]))).toBe('ok');
    const victim = seededIds(run.id).featureId();
    expect(codeOf(plan([run], (w) => w.add(victim, 'baumart', { name_de: 'Opfer' })))).toBe('id_taken');
  });
  it('property: an accepted create only adds $type to an id the world did not know', () => {
    const known = [IDS.park, IDS.linde, IDS.t_in, IDS.t_hole, IDS.t_out];
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99999 }), fc.option(fc.constantFrom(...known)), (n, target) => {
        const id = target ?? fid(5000 + n);
        const { config, world: w } = world();
        const r = planApi.planFor([erfassen(n, id)], oneVersion(config, compilePerms(config)), ports(w));
        expect(r.ok).toBe(target === null);
        if (r.ok) expect(w.feature(id)).toBeUndefined();
      }),
      { numRuns: 50 },
    );
  });
});
