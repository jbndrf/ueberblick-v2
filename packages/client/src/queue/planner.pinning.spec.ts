// WP-319 (A-029 item 2, device side): the device plans each run under the config version of the feature it touches.
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { FeatureState } from '@ueberblick/core/model';
import type { Key, Run } from '@ueberblick/core/model';
import { describe, expect, it } from 'vitest';
import type { RunQueueDeps } from './contract';
import { createPlanner } from './planner';
import { anna, befundErgaenzen, IDS, kontrolle, makeKit, runId } from './queue.testing';
import { musterstadt } from './world.testing';

const create = (n: number, configVersion: number): Run => ({
  id: runId(n),
  task: 'erfassen' as Key,
  actor: anna,
  configVersion,
  input: { geometrie: { type: 'Point', coordinates: [7.102, 50.732] }, vitalitaet: 'v1' },
});

interface Setup {
  readonly planner: ReturnType<typeof createPlanner>;
  readonly asked: number[];
  readonly available: Set<number>;
}

/** Version 1 and 2 are two compiled copies of the same project; the tree `t_in` is pinned to 2 (the wire's `version`). */
async function setup(deployed: number | undefined, held: readonly number[]): Promise<Setup> {
  const configs = new Map<number, CompiledConfig>([
    [1, musterstadt().config],
    [2, musterstadt().config],
    [3, musterstadt().config],
  ]);
  const available = new Set(held);
  const kit = await makeKit();
  const t = kit.world.features.get(IDS.t_in) as FeatureState;
  await kit.store.applyPage(
    {
      features: [{ ...t, version: 2, updatedSeq: t.updatedSeq + 100 } as FeatureState],
      edges: [],
      observations: [],
      tombstones: [],
      runs: [],
      people: [],
    },
    { kind: 'delta', cursor: 2, scopeFingerprint: 'scope-a' },
  );
  const asked: number[] = [];
  const deps: RunQueueDeps = {
    ...kit.deps,
    config: {
      get: (v) => {
        asked.push(v);
        return available.has(v) ? (configs.get(v) as CompiledConfig) : 'refetching';
      },
      deployed,
    },
  };
  return { planner: createPlanner(deps), asked, available };
}

const versionsOf = (planned: readonly { run: Run }[]) => planned.map((p) => p.run.configVersion);

describe('device planner per feature version', () => {
  it('plans a run on a pinned feature under its version and a create under the deployed one', async () => {
    const s = await setup(3, [1, 2, 3]);
    const pinned = await s.planner.plan([kontrolle(1, IDS.t_in, 'A', { configVersion: 3 })]);
    expect(pinned.kind).toBe('ok');
    if (pinned.kind !== 'ok') return;
    expect(versionsOf(pinned.planned)).toEqual([2]);
    expect(s.asked).toContain(2);

    const made = await s.planner.plan([create(2, 1)]);
    expect(made.kind).toBe('ok');
    if (made.kind !== 'ok') return;
    expect(versionsOf(made.planned)).toEqual([3]);
    const floating = await s.planner.plan([befundErgaenzen(3, IDS.t_hole, 'B')]);
    expect(floating.kind).toBe('ok');
    if (floating.kind !== 'ok') return;
    expect(versionsOf(floating.planned)).toEqual([3]);
  });

  it('waits with { kind: config } while the pinned version is missing, and plans once it arrived', async () => {
    const s = await setup(1, [1]);
    const run = kontrolle(1, IDS.t_in, 'A');
    expect(await s.planner.plan([run])).toEqual({ kind: 'config', version: 2 });
    s.available.add(2);
    const again = await s.planner.plan([run]);
    expect(again.kind).toBe('ok');
    if (again.kind === 'ok') expect(versionsOf(again.planned)).toEqual([2]);
  });

  it('plans a batch whose features span two versions, each under its own', async () => {
    const s = await setup(1, [1, 2]);
    const out = await s.planner.plan([kontrolle(1, IDS.t_in, 'A'), befundErgaenzen(2, IDS.t_hole, 'B')]);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(versionsOf(out.planned)).toEqual([2, 1]);
    expect(out.predictions.map((p) => p.runId)).toEqual([runId(1), runId(2)]);
  });

  it('keeps the pin on a predicted feature, so the next run still plans under it', async () => {
    const s = await setup(1, [1, 2]);
    const first = await s.planner.plan([kontrolle(1, IDS.t_in, 'A')]);
    expect(first.kind).toBe('ok');
    if (first.kind !== 'ok') return;
    const predicted = first.predictions[0]?.features.find((f) => f.id === IDS.t_in) as
      (FeatureState & { version?: number }) | undefined;
    expect(predicted?.version).toBe(2);
  });
});
