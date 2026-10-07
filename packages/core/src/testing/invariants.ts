/**
 * The invariants of docs/07 "Testing", checked on a drained simulation:
 * convergence, no accepted run lost, refused runs leave no trace.
 */
import type { Run, RunId } from '../model';
import type { Violation } from './contract';
import type { SimDevice } from './device';
import type { SimServer } from './server';
import { SIM_CONFIG_VERSION } from './ids';
import { createGeo } from '../geo';
import { MemoryStore } from '../memory';

export interface CheckInput {
  readonly server: SimServer;
  readonly devices: readonly SimDevice[];
  /** Every run a device or the admin submitted (rule runs are not listed: the server made them). */
  readonly submitted: ReadonlyMap<RunId, Run>;
  /** Run ids of seeded imports (they are in the log but were never submitted). */
  readonly seedRuns: ReadonlySet<RunId>;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function checkInvariants(input: CheckInput): Violation[] {
  const v: Violation[] = [];
  convergence(input, v);
  noAcceptedRunLost(input, v);
  refusalsLeaveNoTrace(input, v);
  return v;
}

function convergence({ server, devices }: CheckInput, v: Violation[]): void {
  const want = server.store.snapshot();
  for (const d of devices) {
    const got = d.store.snapshot();
    if (!same(want.features, got.features))
      v.push({ invariant: 'convergence', detail: `device ${d.index}: features differ from the server` });
    if (!same(want.edges, got.edges))
      v.push({ invariant: 'convergence', detail: `device ${d.index}: edges differ from the server` });
    if (d.head !== server.head)
      v.push({
        invariant: 'convergence',
        detail: `device ${d.index}: cursor ${d.head} != server head ${server.head}`,
      });
  }
}

function noAcceptedRunLost({ server, devices, submitted }: CheckInput, v: Violation[]): void {
  const perRun = new Map<RunId, number>();
  for (const o of server.store.log) perRun.set(o.runId, (perRun.get(o.runId) ?? 0) + 1);
  const deviceRefused = new Map<RunId, string>();
  for (const d of devices) for (const r of d.refused) deviceRefused.set(r.run.id, r.refusal.code);

  for (const id of submitted.keys()) {
    const entry = server.ledger.get(id);
    if (entry === undefined) {
      if (!deviceRefused.has(id) && !queuedAnywhere(devices, id))
        v.push({
          invariant: 'no_accepted_run_lost',
          detail: `run ${id} vanished: not on the server, refused or queued`,
        });
    } else if (entry.ok) {
      const a = server.accepted.get(id);
      if (a === undefined || (perRun.get(id) ?? 0) !== a.observationCount)
        v.push({
          invariant: 'no_accepted_run_lost',
          detail: `accepted run ${id} is missing observations in the log`,
        });
      if (deviceRefused.has(id) && deviceRefused.get(id) !== undefined && server.accepted.has(id)) {
        v.push({
          invariant: 'no_accepted_run_lost',
          detail: `run ${id} is accepted on the server but shown as refused on a device`,
        });
      }
    } else if (!deviceRefused.has(id) && !adminRun(devices, id, submitted)) {
      v.push({
        invariant: 'no_accepted_run_lost',
        detail: `refused run ${id} is not visible as refused on any device`,
      });
    }
  }
  for (const d of devices) {
    if (d.queue.length > 0)
      v.push({
        invariant: 'no_accepted_run_lost',
        detail: `device ${d.index} still holds ${d.queue.length} unsent runs after the drain`,
      });
  }
}

const queuedAnywhere = (devices: readonly SimDevice[], id: RunId): boolean =>
  devices.some((d) => d.queue.some((q) => q.run.id === id));

/** Admin runs are not submitted by a device; a refusal there is returned to the admin directly. */
const adminRun = (devices: readonly SimDevice[], id: RunId, submitted: ReadonlyMap<RunId, Run>): boolean =>
  submitted.get(id)?.actor.kind === 'admin' && !devices.some((d) => d.refused.some((r) => r.run.id === id));

function refusalsLeaveNoTrace({ server, devices, submitted, seedRuns }: CheckInput, v: Violation[]): void {
  const log = server.store.log;
  const refusedIds = new Set<RunId>();
  for (const [id, e] of server.ledger) if (!e.ok) refusedIds.add(id);
  for (const d of devices) for (const r of d.refused) refusedIds.add(r.run.id);
  for (const o of log) {
    if (refusedIds.has(o.runId))
      v.push({
        invariant: 'refusal_leaves_no_trace',
        detail: `refused run ${o.runId} left observation seq ${o.seq}`,
      });
    if (!seedRuns.has(o.runId) && !server.accepted.has(o.runId))
      v.push({
        invariant: 'refusal_leaves_no_trace',
        detail: `observation seq ${o.seq} belongs to run ${o.runId}, which the server never accepted`,
      });
  }
  log.forEach((o, i) => {
    if (o.seq !== i + 1)
      v.push({ invariant: 'refusal_leaves_no_trace', detail: `seq gap: position ${i} holds seq ${o.seq}` });
  });
  // Current state is the fold of the accepted log alone: replay it in one chunk on a fresh store.
  const fresh = new MemoryStore(server.config, server.clock, createGeo(), SIM_CONFIG_VERSION);
  fresh.applyRecorded(log);
  if (!same(fresh.snapshot(), server.store.snapshot()))
    v.push({
      invariant: 'refusal_leaves_no_trace',
      detail: 'state differs from the fold of the accepted log',
    });
  for (const id of submitted.keys()) {
    const e = server.ledger.get(id);
    if (e && !e.ok && server.accepted.has(id))
      v.push({ invariant: 'refusal_leaves_no_trace', detail: `run ${id} is both refused and accepted` });
  }
}
