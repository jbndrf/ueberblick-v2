/**
 * The seeded simulator: N devices and one server on a lossy network, with offline periods, restarts and
 * admin batches (H2). `simulate(workload, options)` is a pure function of its arguments: the same seed
 * gives the same run, so a failing seed number is the whole bug report.
 */
import type { NetworkFaults, RunDraft, SimOptions, SimReport, Violation, Workload } from './contract';
import { PULL_PAGE, SimDevice, type Request, type Response } from './device';
import { SEED_RUN, SIM_CONFIG_VERSION, createClock, createIds } from './ids';
import { checkInvariants, type CheckInput } from './invariants';
import { SimNetwork } from './network';
import { createRng } from './prng';
import { SimServer } from './server';
import { createGeo } from '../geo';
import type { Run, RunId } from '../model';
import { PLAN_MAX_RULE_DEPTH } from '../plan';

export const START = '2026-05-01T08:00:00.000Z';
const ADMIN_SOURCE = 0x7ffffffe;
const MAX_DRAIN_TICKS = 3000;

export const DEFAULT_OPTIONS: Omit<SimOptions, 'seed'> = {
  devices: 3,
  ticks: 40,
  faults: { drop: 0.15, duplicate: 0.15, maxDelay: 4 },
  offlineFlip: 0.08,
  restart: 0.03,
  runRate: 0.35,
  adminRate: 0.05,
};

const NO_FAULTS: NetworkFaults = { drop: 0, duplicate: 0, maxDelay: 0 };

const hash = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
};

/** The end state of a simulation, for tests that tamper with it to prove the invariants can fail. */
export interface SimWorld {
  readonly report: SimReport;
  readonly input: CheckInput;
}

export function simulate(workload: Workload, options: SimOptions): SimReport {
  return simulateWorld(workload, options).report;
}

export function simulateWorld(workload: Workload, options: SimOptions): SimWorld {
  const rng = createRng(options.seed);
  const clock = createClock(START);
  const server = new SimServer(workload.config, workload.perms, clock, createGeo(), {
    ruleDepth: PLAN_MAX_RULE_DEPTH,
  });
  server.seed((store) => workload.seed(store));
  const seedRuns = new Set<RunId>([SEED_RUN]);
  const net = new SimNetwork<Request | Response>(rng, options.faults);
  const devices = Array.from({ length: options.devices }, (_, i) => {
    const actor = workload.participants[i % workload.participants.length];
    if (actor === undefined) throw new Error('workload has no participants');
    return new SimDevice(i, actor, workload.config, workload.perms, clock, undefined, server.store);
  });
  const adminIds = createIds(ADMIN_SOURCE);
  const submitted = new Map<RunId, Run>();
  let adminBatches = 0;

  const serve = (m: Request): Response => {
    if (m.kind === 'submit') {
      const res = server.submit([m.run]);
      const entry = res.results[0]?.entry;
      if (entry === undefined) throw new Error('server answered nothing');
      return { kind: 'submitted', device: m.device, runId: m.run.id, entry };
    }
    const page = server.pull(m.since, PULL_PAGE);
    return {
      kind: 'page',
      device: m.device,
      since: m.since,
      upTo: page.upTo,
      observations: page.observations,
    };
  };
  const step = (tick: number): void => {
    for (const m of net.deliver(tick)) {
      if (m.kind === 'submit' || m.kind === 'pull') net.send(serve(m), tick);
      else devices[m.device]?.receive(m);
    }
    for (const d of devices) for (const m of d.tick(tick)) net.send(m, tick);
  };

  for (let tick = 1; tick <= options.ticks; tick++) {
    clock.advance(1000);
    for (const d of devices) {
      if (rng.chance(options.offlineFlip)) d.online = !d.online;
      if (rng.chance(options.restart)) d.restart();
      if (rng.chance(options.runRate)) {
        const draft = workload.nextRun(rng, d.predicted, d.actor);
        if (draft) {
          const run = d.create(draft);
          submitted.set(run.id, run);
        }
      }
    }
    if (workload.adminBatch && rng.chance(options.adminRate)) {
      const drafts: readonly RunDraft[] = workload.adminBatch(rng, server.store, workload.admin);
      const runs: Run[] = drafts.map((d) => ({
        ...d,
        id: adminIds.runId(),
        configVersion: SIM_CONFIG_VERSION,
      }));
      if (runs.length > 0) {
        for (const r of runs) submitted.set(r.id, r);
        server.submit(runs, true);
        adminBatches++;
      }
    }
    step(tick);
  }
  return finish();

  function finish(): SimWorld {
    net.faults = NO_FAULTS;
    for (const d of devices) d.online = true;
    let tick = options.ticks;
    // Devices pull periodically, so the network is never empty; quiet means every queue is empty and every
    // device has the server head. Stragglers sent under faults (duplicates, late answers) are then let
    // in for a few more ticks, and the checks below must still hold.
    const quiet = (): boolean => devices.every((d) => d.queue.length === 0 && d.head === server.head);
    const advance = (): void => {
      clock.advance(1000);
      step(++tick);
    };
    while (!quiet() && tick < options.ticks + MAX_DRAIN_TICKS) advance();
    for (let i = 0; i < options.faults.maxDelay + 8; i++) advance();
    const violations: Violation[] = quiet()
      ? []
      : [
          {
            invariant: 'quiescence',
            detail: `no quiescence after ${MAX_DRAIN_TICKS} ticks (seed ${options.seed}): server head ${server.head}, devices ${JSON.stringify(devices.map((d) => [d.head, d.queue.map((q) => [q.run.task, q.acceptedSeq])]))}`,
          },
        ];
    const input: CheckInput = { server, devices, submitted, seedRuns };
    violations.push(...checkInvariants(input));
    const accepted = server.accepted.size;
    const stats = {
      submitted: submitted.size,
      accepted,
      refusedOnDevice: devices.reduce((n, d) => n + d.refused.filter((r) => r.where === 'device').length, 0),
      refusedOnServer: [...server.ledger.values()].filter((e) => !e.ok).length,
      adminBatches,
      serverSeq: server.head,
    };
    const digest = hash(JSON.stringify([stats, server.store.snapshot()]));
    return { report: { seed: options.seed, violations, digest, stats }, input };
  }
}
