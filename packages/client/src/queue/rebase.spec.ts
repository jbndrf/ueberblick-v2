// WP-511: prediction, rebase after a refusal, re-derivation after a sync reset. Property test against a core replay.
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { createPlan, oneVersion } from '@ueberblick/core/plan';
import { compilePerms } from '@ueberblick/core/perms';
import { formApi } from '@ueberblick/core/form';
import type { FeatureId, Run } from '@ueberblick/core/model';
import { openDeviceStore } from '../store/open';
import { fakeEnv, memoryMarker, rows as pageRows } from '../store/test-env';
import { createRunQueue } from './queue';
import { IDS, befundErgaenzen, kontrolle, makeKit, refusal, runId, type Kit } from './queue.testing';
import { ports } from './world.testing';

const T = IDS.t_in;
const befund = (k: Kit, id: FeatureId) => k.store.facts.feature(id)?.properties['befund'];

describe('rebase after a refusal', () => {
  it('refuses only the later runs that now fail; independent runs stay; refused input is kept', async () => {
    const k = await makeKit();
    const x = kontrolle(1, T, 'Pilz');
    const w = kontrolle(2, T, 'unauffällig'); // fine while x's befund is predicted, fails once x is gone
    const v = befundErgaenzen(3, T, 'Neu');
    const other = befundErgaenzen(4, IDS.t_hole, 'Riss');
    for (const r of [x, w, v, other]) expect(await k.queue.enqueue(r)).toMatchObject({ ok: true });
    expect(befund(k, T)).toBe('Neu');

    k.server.script = { refuse: (run) => (run.id === x.id ? refusal('not_permitted') : undefined) };
    await k.queue.drain();
    const status = k.queue.status();
    expect(status.refused.map((r) => [r.runId, r.refusal.code])).toEqual([
      [x.id, 'not_permitted'],
      [w.id, 'constraint_failed'],
    ]);
    expect(status.refused[1]?.input).toEqual({ vitalitaet: 'v1', befund: 'unauffällig' });
    // w was refused on the device by the rebase and never sent; v and other went on and were accepted
    const sent = k.server.sent.map((p) => (p.kind === 'run' ? p.run.id : ''));
    expect(sent).toEqual([x.id, v.id, other.id]);
    expect(befund(k, T)).toBe('Neu');
    expect(befund(k, IDS.t_hole)).toBe('Riss');
  });

  it("drops the refused run's prediction at once", async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    expect(befund(k, T)).toBe('A');
    k.server.script = { refuse: () => refusal('not_available') };
    await k.queue.drain();
    expect(befund(k, T)).toBe('unauffällig');
  });

  it('a refused later run never blocks the ones after it', async () => {
    const k = await makeKit();
    for (let n = 1; n <= 3; n++) await k.queue.enqueue(befundErgaenzen(n, T, `v${n}`));
    k.server.script = { refuse: (run) => (run.id === runId(2) ? refusal('not_permitted') : undefined) };
    await k.queue.drain();
    expect(k.queue.status().refused.map((r) => r.runId)).toEqual([runId(2)]);
    expect(k.server.applied.size).toBe(2);
    expect(befund(k, T)).toBe('v3');
  });
});

describe('prediction and warmHistory', () => {
  it("warms the history of the run's feature before planning (B-004)", async () => {
    const k = await makeKit();
    const order: string[] = [];
    const warm = vi.spyOn(k.store, 'warmHistory').mockImplementation((ids) => {
      order.push(`warm:${ids.includes(T)}`);
      return Promise.resolve();
    });
    vi.spyOn(k.store, 'putPrediction').mockImplementation(() => {
      order.push('predict');
      return Promise.resolve();
    });
    await k.queue.enqueue(kontrolle(1, T, 'Pilz'));
    expect(warm).toHaveBeenCalled();
    expect(order[0]).toBe('warm:true');
    expect(order).toContain('predict');
  });

  it("a rule run's effects are part of the prediction of the run that caused it", async () => {
    const k = await makeKit();
    await k.queue.enqueue(kontrolle(1, T, 'Pilz'));
    // kontrolle sets stage and writes the area's letzte_kontrolle through its bind
    expect(k.store.facts.feature(T)?.properties['stage']).toBe('kontrolliert');
    expect(k.store.facts.feature(IDS.park)?.properties['letzte_kontrolle']).toBe('2026-05-01');
  });
});

describe('re-deriving predictions after a sync reset', () => {
  it('re-plans the queued runs over the new server state; a run that now fails stays queued, not refused', async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    await k.queue.enqueue(kontrolle(2, T, 'server-says'));
    expect(befund(k, T)).toBe('server-says');
    // the server state moved: a snapshot page brings a tree whose befund equals run 2's
    const tree = k.store.facts.feature(T);
    if (!tree) throw new Error('seeded');
    await k.store.clearCache();
    await k.store.applyPage(
      pageRows({
        features: [{ ...tree, properties: { ...tree.properties, befund: 'server-says' }, updatedSeq: 999 }],
      }),
      { kind: 'delta', cursor: 999, scopeFingerprint: 'scope-b' },
    );
    await k.queue.rederive('scope_changed');
    const s = k.queue.status();
    expect(s).toMatchObject({ pending: 2, refused: [] });
    // run 1 predicts again on the new base; run 2 fails now (constraint) so it has no prediction
    expect(befund(k, T)).toBe('A');
  });

  it('after a restart the queue rebuilds predictions a crash left out', async () => {
    const env = fakeEnv();
    const k = await makeKit({ env });
    vi.spyOn(k.store, 'putPrediction').mockRejectedValueOnce(new Error('crash before the prediction'));
    await expect(k.queue.enqueue(befundErgaenzen(1, T, 'A'))).rejects.toThrow();
    k.store.close();
    const store = await openDeviceStore('q', { env, marker: memoryMarker(true) });
    expect(store.facts.feature(T)?.properties['befund']).toBe('unauffällig');
    const q = await createRunQueue({ ...k.deps, store });
    expect(q.status().pending).toBe(1);
    expect(store.facts.feature(T)?.properties['befund']).toBe('A');
  });

  it('a first sync (no cursor) re-derives too', async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    const put = vi.spyOn(k.store, 'putPrediction');
    await k.queue.rederive('first_sync');
    expect(put).toHaveBeenCalledTimes(1);
  });
});

// The oracle: replay the runs on a copy of the world with core.plan alone.
// Phase 1 is what the device saw at enqueue: each run planned over the runs before it. A run refused THERE stays a
// refused draft (the user saw the refusal and re-enters it; a later server refusal of a predecessor does not revive
// it). Phase 2 replays the survivors over the base, skipping the runs the server refused.
const planApi = createPlan(formApi);

function oracle(k: Kit, runs: readonly Run[], serverRefuses: ReadonlySet<string>): Map<string, unknown> {
  const perms = compilePerms(k.config);
  const replay = (skip: (run: Run) => boolean, onRefused?: (run: Run) => void) => {
    const world = k.world.clone();
    const p = ports(world);
    for (const run of runs) {
      if (skip(run)) continue;
      const r = planApi.planFor([run], oneVersion(k.config, perms), p);
      if (!r.ok) {
        onRefused?.(run);
        continue;
      }
      for (const pr of r.runs) world.append(pr.run.id, pr.observations);
    }
    return world;
  };
  const drafts = new Set<string>();
  replay(
    () => false,
    (run) => drafts.add(run.id),
  );
  const world = replay((run) => drafts.has(run.id) || serverRefuses.has(run.id));
  return new Map([...world.features].map(([id, f]) => [id, f.properties]));
}

const trees = [IDS.t_in, IDS.t_hole, IDS.t_out];
interface Spec {
  readonly kind: string;
  readonly tree: number;
  readonly text: string;
  readonly refuse: boolean;
}
const arbRun = fc.record({
  kind: fc.constantFrom('kontrolle', 'ergaenzen'),
  tree: fc.integer({ min: 0, max: 2 }),
  text: fc.constantFrom('A', 'B', 'C', 'unauffällig'),
  refuse: fc.boolean(),
});

async function check(specs: readonly Spec[]): Promise<void> {
  const k = await makeKit();
  const runs: Run[] = specs.map((s, i) => {
    const tree = trees[s.tree] as FeatureId;
    return s.kind === 'kontrolle' ? kontrolle(i + 1, tree, s.text) : befundErgaenzen(i + 1, tree, s.text);
  });
  const refuses = new Set(runs.filter((_, i) => specs[i]?.refuse).map((r) => r.id as string));
  for (const r of runs) await k.queue.enqueue(r);
  // before any send the prediction equals the replay with nothing refused by the server
  for (const [id, props] of oracle(k, runs, new Set()))
    expect(k.store.facts.feature(id as FeatureId)?.properties).toEqual(props);
  k.server.script = { refuse: (run) => (refuses.has(run.id) ? refusal('not_permitted') : undefined) };
  await k.queue.drain();
  for (const [id, props] of oracle(k, runs, refuses))
    expect(k.store.facts.feature(id as FeatureId)?.properties).toEqual(props);
  const s = k.queue.status();
  expect(s.pending).toBe(0);
  expect(s.unpredicted).toEqual([]);
  // every run is accounted for: accepted (awaiting pull) or refused, none vanished
  expect(s.awaitingPull + s.refused.length + s.review.length).toBe(runs.length);
}

describe('property: the prediction equals a core replay of the surviving runs', () => {
  const property = fc.asyncProperty(fc.array(arbRun, { minLength: 1, maxLength: 6 }), check);

  it('holds for random queues with random server refusals', async () => {
    await fc.assert(property, { numRuns: Number(process.env['QUEUE_PROP_RUNS'] ?? 100) });
  });

  // review 1 counterexamples (they failed about 2 in 12 runs): a run refused at enqueue because a predecessor's
  // prediction made it invalid is a draft, and stays one when that predecessor is refused by the server
  it.each([158509628, 547038394])('seed %i, pinned', async (seed) => {
    await fc.assert(property, { seed, numRuns: 25 });
  });

  it('the shape of those counterexamples: three kontrolle on tree 0, server refuses 1 and 3', async () => {
    const spec = (text: string, refuse: boolean): Spec => ({ kind: 'kontrolle', tree: 0, text, refuse });
    for (const a of ['A', 'B', 'unauffällig'])
      for (const b of ['A', 'B', 'C', 'unauffällig'])
        for (const c of ['A', 'C', 'unauffällig'])
          await check([spec(a, true), spec(b, false), spec(c, true)]);
  });
});

describe('accepted entries are never re-planned by a rebase', () => {
  it('a later refusal keeps the prediction of an accepted run, including its rule effect on the area', async () => {
    const k = await makeKit();
    await k.queue.enqueue(kontrolle(1, T, 'A'));
    await k.queue.enqueue(befundErgaenzen(2, T, 'B'));
    k.server.script = { refuse: (run) => (run.id === runId(2) ? refusal('not_permitted') : undefined) };
    const put = vi.spyOn(k.store, 'putPrediction');
    await k.queue.drain();
    expect(put).not.toHaveBeenCalledWith(expect.objectContaining({ runId: runId(1) }));
    expect(k.store.facts.feature(IDS.park)?.properties['letzte_kontrolle']).toBe('2026-05-01');
    expect(befund(k, T)).toBe('A');
    expect(k.queue.status().unpredicted).toEqual([]);
  });

  it('a re-derivation that cannot re-plan an accepted run says so in the status, never silently', async () => {
    const k = await makeKit();
    await k.queue.enqueue(kontrolle(1, T, 'A'));
    await k.queue.drain();
    const tree = k.store.facts.feature(T);
    if (!tree) throw new Error('seeded');
    await k.store.applyPage(
      pageRows({ features: [{ ...tree, properties: { ...tree.properties, befund: 'A' }, updatedSeq: 999 }] }),
      { kind: 'delta', cursor: 999, scopeFingerprint: 'scope-b' },
    );
    await k.queue.rederive('scope_changed'); // run 1 would now repeat the befund: its constraint fails
    expect(k.queue.status().unpredicted).toEqual([runId(1)]);
    expect(k.queue.status().awaitingPull).toBe(1);
    expect(await k.store.readRuns()).toHaveLength(1);
  });
});
