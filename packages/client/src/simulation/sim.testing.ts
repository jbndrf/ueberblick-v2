/**
 * The seeded simulator against the real adapters: N devices (fake-indexeddb store, run queue, sync worker) and
 * one backend (SQLite behind the real endpoint handlers), with lost, duplicated and late requests, offline
 * periods, restarts, atomic batches (H2) and admin batches, then a fault-free drain and the three invariants.
 * `simulateReal` is a pure function of its arguments: the seed is the bug report.
 */
import type { Run, RunId } from '@ueberblick/core/model';
import {
  START,
  createClock,
  createIds,
  createRng,
  type FakeClock,
  type Violation,
  type Workload,
} from '@ueberblick/core/testing';
import type { RealSimOptions, RealSimReport, SimBackend } from './contract.testing';
import { RealDevice } from './device.testing';
import { freshDump } from './dump.testing';
import { checkReal, type RealCheckInput } from './invariants.testing';
import { Faults, NO_FAULTS } from './net.testing';

/** Source number for the ids the admin mints; devices use 1..n. */
const ADMIN_SOURCE = 0x7ffffffe;
const DRAIN_ROUNDS = 400;
/** Extra pulls after quiet: late duplicates that were still on the wire must change nothing. */
const SETTLE_ROUNDS = 3;

export type BackendFactory = (workload: Workload, clock: FakeClock) => SimBackend;

export const DEFAULT_REAL_OPTIONS: Omit<RealSimOptions, 'seed'> = {
  devices: 4,
  runsPerDevice: 30,
  faults: { drop: 0.15, duplicate: 0.15, maxDelay: 4 },
  offlineFlip: 0.08,
  restart: 0.04,
  runRate: 0.5,
  adminRate: 0.05,
  batchRate: 0.08,
};

const hash = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
};

const isVerwaltung = (d: RealDevice): boolean => (d.actor.roles as readonly string[]).includes('verwaltung');

/** The end state of a simulation, for tests that tamper with it to prove the invariants can fail. */
export interface RealWorld {
  readonly report: RealSimReport;
  readonly input: RealCheckInput;
}

export async function simulateReal(
  workload: Workload,
  makeBackend: BackendFactory,
  options: RealSimOptions,
): Promise<RealSimReport> {
  const world = await simulateRealWorld(workload, makeBackend, options);
  for (const d of world.input.devices) d.store.close();
  return world.report;
}

export async function simulateRealWorld(
  workload: Workload,
  makeBackend: BackendFactory,
  options: RealSimOptions,
): Promise<RealWorld> {
  const rng = createRng(options.seed);
  const clock = createClock(START);
  let tick = 0;
  const backend = makeBackend(workload, clock);
  backend.seed((store) => workload.seed(store));
  const faults = new Faults(rng, options.faults, () => tick);

  const devices: RealDevice[] = [];
  for (let i = 0; i < options.devices; i++) {
    const actor = workload.participants[i % workload.participants.length];
    if (actor === undefined) throw new Error('workload has no participants');
    devices.push(
      await RealDevice.open({
        index: i,
        actor,
        backend,
        clock,
        faults,
        ids: createIds(i + 1),
        maxRows: 4 + rng.int(20),
      }),
    );
  }
  const adminIds = createIds(ADMIN_SOURCE);
  const submitted = new Map<RunId, Run>();
  const left = devices.map(() => options.runsPerDevice);
  let adminBatches = 0;
  let deviceBatches = 0;
  const maxTicks = options.maxTicks ?? options.runsPerDevice * 40 + 200;

  const userActs = async (d: RealDevice): Promise<void> => {
    if ((left[d.index] ?? 0) <= 0 || !rng.chance(options.runRate)) return;
    left[d.index] = (left[d.index] ?? 1) - 1;
    if (workload.adminBatch && isVerwaltung(d) && rng.chance(options.batchRate)) {
      await d.createBatch(workload.adminBatch(rng, d.view, workload.admin));
      deviceBatches++;
      return;
    }
    const draft = workload.nextRun(rng, d.view, d.actor);
    if (draft) await d.create(draft);
  };

  while (tick < maxTicks && left.some((n) => n > 0)) {
    tick++;
    clock.advance(1000);
    await faults.deliverLate();
    for (const d of devices) {
      if (rng.chance(options.offlineFlip)) {
        d.link.online = !d.link.online;
        if (d.link.online) d.reconnect();
      }
      if (rng.chance(options.restart)) await d.restart(rng.chance(0.5));
      await userActs(d);
      await d.drain();
      if (tick % 3 === 0 || d.queue.status().awaitingPull > 0) await d.pull();
    }
    const first = devices[0];
    if (workload.adminBatch && first && rng.chance(options.adminRate)) {
      const drafts = workload.adminBatch(rng, first.view, workload.admin);
      const runs: Run[] = drafts.map((d) => ({ ...d, id: adminIds.runId(), configVersion: 1 }));
      if (runs.length > 0) {
        adminBatches++;
        backend.submitDirect(runs);
        for (const r of runs) submitted.set(r.id, r);
      }
    }
  }
  for (const d of devices) for (const r of d.submitted) submitted.set(r.id, r);

  // The network heals: every device online, every late duplicate delivered, then pull until nothing moves.
  faults.faults = NO_FAULTS;
  for (const d of devices) {
    d.link.online = true;
    d.reconnect();
  }
  await faults.deliverLate(true);
  const rounds = options.drainRounds ?? DRAIN_ROUNDS;
  const quiet = (): boolean => devices.every((d) => d.livePending() === 0 && d.cursor() === backend.head());
  for (let round = 0; round < rounds && !quiet(); round++) {
    clock.advance(1000);
    for (const d of devices) {
      await d.drain();
      await d.pull();
    }
  }
  const violations: Violation[] = [];
  if (!quiet())
    violations.push({
      invariant: 'quiescence',
      detail: `no quiescence after ${rounds} rounds (seed ${options.seed}): server head ${backend.head()}, devices ${JSON.stringify(devices.map((d) => [d.cursor(), d.livePending()]))}`,
    });
  for (let i = 0; i < SETTLE_ROUNDS; i++) for (const d of devices) await d.pull();

  const oracle = new Map<string, Awaited<ReturnType<typeof freshDump>>>();
  for (const d of devices)
    if (!oracle.has(d.actor.id)) oracle.set(d.actor.id, await freshDump(backend, d.actor, 7, START));
  const audit = backend.audit();
  const input: RealCheckInput = { audit, devices, submitted, oracle };
  violations.push(...checkReal(input));

  const deviceRefused = new Set<RunId>();
  for (const d of devices) for (const r of d.queue.status().refused) deviceRefused.add(r.runId);
  const stats = {
    submitted: submitted.size,
    accepted: [...submitted.keys()].filter((id) => audit.runs.get(id)?.outcome === 'accepted').length,
    refusedOnDevice: [...deviceRefused].filter((id) => !audit.runs.has(id)).length,
    refusedOnServer: [...audit.runs.values()].filter((r) => r.outcome === 'rejected').length,
    adminBatches,
    deviceBatches,
    restarts: devices.reduce((n, d) => n + d.restarts, 0),
    ticks: tick,
    serverSeq: audit.head,
    requestsLost: faults.stats.requestsLost,
    repliesLost: faults.stats.repliesLost,
    duplicates: faults.stats.duplicates,
    lateDuplicates: faults.stats.lateDuplicates,
  };
  const digest = hash(JSON.stringify([stats, [...audit.features], audit.observations]));
  return { report: { seed: options.seed, options, violations, digest, stats }, input };
}
