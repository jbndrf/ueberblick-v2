/**
 * WP-513: the WP-050 invariants hold with the real IndexedDB store, run queue and sync worker on the device and
 * the real SQLite run store, run handlers and sync handlers on the server, under seeded network faults.
 * This is the short profile (`npm run check`); the long one is `long-*.spec.ts` (`npm run sim`).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { RunId } from '../../../packages/core/src/model';
import { baumWorkload } from '../../../packages/core/src/testing';
import type { RealSimOptions, RealSimReport, SimBackend } from '../../../packages/client/src/simulation/contract.testing';
import { checkReal } from '../../../packages/client/src/simulation/invariants.testing';
import { failWithRepro } from '../../../packages/client/src/simulation/repro.testing';
import {
  simulateReal,
  simulateRealWorld,
  type BackendFactory,
  type RealWorld,
} from '../../../packages/client/src/simulation/sim.testing';
import { sqliteBackend } from './backend';
import { optionsFor, REGRESSION_SEEDS, seedsOf } from './profiles';

const workload = baumWorkload();
const run = (o: RealSimOptions): Promise<RealSimReport> => simulateReal(workload, sqliteBackend, o);
const seeds = [...new Set([...seedsOf('check'), ...REGRESSION_SEEDS])];

describe('check profile: the three invariants hold for every seed (one self-contained test each)', () => {
  it.each(seeds)('seed %i: convergence, no accepted run lost, refusals leave no trace', async (seed) => {
    const report = await run(optionsFor('check', seed));
    await failWithRepro(run, report);
    expect(report.violations).toEqual([]);
  });

  it('the workload really exercises faults, restarts and both kinds of batch (H2)', async () => {
    const r = await run({
      ...optionsFor('check', 3),
      devices: 4,
      runsPerDevice: 20,
      faults: { drop: 0.3, duplicate: 0.4, maxDelay: 4 },
      restart: 0.1,
      batchRate: 0.3,
      adminRate: 0.3,
    });
    const s = r.stats;
    for (const n of [s.accepted, s.refusedOnDevice, s.adminBatches, s.deviceBatches, s.restarts, s.requestsLost, s.repliesLost, s.duplicates, s.lateDuplicates])
      expect(n).toBeGreaterThan(0);
    expect(r.violations).toEqual([]);
  });
});

describe('a simulation is a pure function of its seed', () => {
  it('the same seed gives the same digest and the same numbers; another seed differs', async () => {
    const o = { ...optionsFor('check', 2), devices: 2, runsPerDevice: 8 };
    const a = await run(o);
    const b = await run(o);
    const c = await run({ ...o, seed: 3 });
    expect(a.digest).toBe(b.digest);
    expect(a.stats).toEqual(b.stats);
    expect(c.digest).not.toBe(a.digest);
  }, 60_000);
});

describe('the invariants can fail (the checks are not vacuous)', () => {
  let world: RealWorld;
  beforeAll(async () => {
    world = await simulateRealWorld(workload, sqliteBackend, {
      ...optionsFor('check', 4),
      devices: 3,
      runsPerDevice: 14,
    });
  }, 60_000);

  const invariants = (input: RealWorld['input']): string[] => checkReal(input).map((v) => v.invariant);
  const acceptedIds = (): RunId[] =>
    [...world.input.audit.runs].filter(([id, r]) => r.outcome === 'accepted' && world.input.submitted.has(id)).map(([id]) => id);
  const withRuns = (edit: (m: Map<RunId, { outcome: 'accepted' | 'rejected'; actorKind: string; causedBy: RunId | undefined }>) => void): RealWorld['input'] => {
    const runs = new Map(world.input.audit.runs);
    edit(runs);
    return { ...world.input, audit: { ...world.input.audit, runs } };
  };

  it('the untouched world is clean', () => {
    expect(checkReal(world.input)).toEqual([]);
    expect(acceptedIds().length).toBeGreaterThan(0);
  });

  it('convergence: a device that differs from a fresh snapshot is caught', () => {
    const [actor, dump] = [...world.input.oracle][0] ?? [];
    expect(dump).toBeDefined();
    const oracle = new Map(world.input.oracle);
    oracle.set(actor as string, { ...(dump as NonNullable<typeof dump>), features: (dump?.features ?? []).slice(1) });
    expect(invariants({ ...world.input, oracle })).toContain('convergence');
  });

  it('convergence: a cursor behind the server head is caught', () => {
    const audit = { ...world.input.audit, head: world.input.audit.head + 1 };
    expect(invariants({ ...world.input, audit })).toContain('convergence');
  });

  it('no accepted run lost: a run the server has no row for and no device shows is caught', () => {
    const id = acceptedIds()[0] as RunId;
    expect(invariants(withRuns((m) => m.delete(id)))).toContain('no_accepted_run_lost');
  });

  it('no accepted run lost: a run accepted by the server but shown refused on a device is caught', () => {
    const refused = world.input.devices.flatMap((d) => d.queue.status().refused.map((r) => r.runId));
    const id = refused.find((r) => world.input.submitted.has(r));
    expect(id).toBeDefined();
    const input = withRuns((m) => m.set(id as RunId, { outcome: 'accepted', actorKind: 'participant', causedBy: undefined }));
    expect(invariants(input)).toContain('no_accepted_run_lost');
  });

  it('no accepted run lost: a rejected run no device shows is caught', () => {
    const id = acceptedIds()[0] as RunId;
    const input = withRuns((m) => m.set(id, { outcome: 'rejected', actorKind: 'participant', causedBy: undefined }));
    expect(invariants(input)).toContain('no_accepted_run_lost');
  });

  it('refusals leave no trace: an observation of a rejected run is caught', () => {
    const id = acceptedIds()[0] as RunId;
    const input = withRuns((m) => m.set(id, { outcome: 'rejected', actorKind: 'participant', causedBy: undefined }));
    expect(invariants(input)).toContain('refusal_leaves_no_trace');
  });

  it('refusals leave no trace: a seq gap and a state that is not the fold of the log are caught', () => {
    const observations = world.input.audit.observations.filter((_, i) => i !== 3);
    expect(invariants({ ...world.input, audit: { ...world.input.audit, observations } })).toContain('refusal_leaves_no_trace');
    const audit = { ...world.input.audit, foldMismatches: ['feature x'] };
    expect(invariants({ ...world.input, audit })).toContain('refusal_leaves_no_trace');
  });
});

/** A server that lies: it answers "accepted" to every run without applying it. */
const lyingBackend: BackendFactory = (w, clock): SimBackend => {
  const inner = sqliteBackend(w, clock);
  let sent = 0;
  return {
    ...inner,
    runTransport(actor) {
      const real = inner.runTransport(actor);
      return {
        send(payload) {
          if (payload.kind === 'run' && ++sent > 0)
            return Promise.resolve({
              kind: 'response',
              response: { outcome: 'accepted', runId: payload.run.id, seq: { from: 99_999, to: 99_999 } },
            });
          return real.send(payload);
        },
      };
    },
  };
};

describe('a failing seed prints a minimal reproduction', () => {
  it('shrinks devices, runs and faults, and prints a command that replays it', async () => {
    const failing = (o: RealSimOptions): Promise<RealSimReport> => simulateReal(workload, lyingBackend, { ...o, drainRounds: 2 });
    const original = { ...optionsFor('check', 7), devices: 2, runsPerDevice: 6, offlineFlip: 0, restart: 0, adminRate: 0, batchRate: 0 };
    const report = await failing(original);
    expect(report.violations.length).toBeGreaterThan(0);
    const error = await failWithRepro(failing, report).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('simulation failed: seed 7');
    expect(message).toContain('SIM_SEED=7');
    expect(message).toContain('npm run sim');
    const devices = Number(/SIM_DEVICES=(\d+)/.exec(message)?.[1]);
    const runs = Number(/SIM_RUNS=(\d+)/.exec(message)?.[1]);
    expect(devices).toBeLessThanOrEqual(2);
    expect(runs).toBeLessThan(6);
    expect(/SIM_DROP=0 /.test(message) && /SIM_OFFLINE=0 /.test(message)).toBe(true);
  }, 240_000);
});
