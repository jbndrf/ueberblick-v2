/**
 * The invariants of docs/07 "Testing", checked on a drained simulation against the real adapters:
 * convergence, no accepted run lost, refused runs leave no trace.
 */
import type { FeatureId, Run, RunId } from '@ueberblick/core/model';
import type { Violation } from '@ueberblick/core/testing';
import type { ServerAudit } from './contract.testing';
import type { RealDevice } from './device.testing';
import type { StoreDump } from './dump.testing';

export interface RealCheckInput {
  readonly audit: ServerAudit;
  readonly devices: readonly RealDevice[];
  /** Every run a device or the admin submitted (rule runs are not listed: the server made them). */
  readonly submitted: ReadonlyMap<RunId, Run>;
  /** A fresh device's snapshot per actor id: what every device of that actor must equal after the drain. */
  readonly oracle: ReadonlyMap<string, StoreDump>;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function checkReal(input: RealCheckInput): Violation[] {
  const v: Violation[] = [];
  convergence(input, v);
  noAcceptedRunLost(input, v);
  refusalsLeaveNoTrace(input, v);
  return v;
}

function convergence({ audit, devices, oracle }: RealCheckInput, v: Violation[]): void {
  const say = (detail: string): number => v.push({ invariant: 'convergence', detail });
  for (const d of devices) {
    const got = d.dump();
    const want = oracle.get(d.actor.id);
    if (want === undefined) {
      say(`device ${d.index}: no oracle for actor ${d.actor.id}`);
      continue;
    }
    if (!same(want.features, got.features)) say(`device ${d.index}: features differ from a fresh snapshot`);
    if (!same(want.edges, got.edges)) say(`device ${d.index}: edges differ from a fresh snapshot`);
    if (got.cursor !== audit.head)
      say(`device ${d.index}: cursor ${String(got.cursor)} != server head ${audit.head}`);
    // the server's own rows: every feature the device holds exists there with the same type and values
    for (const f of got.features) {
      const s = audit.features.get(f.id as FeatureId);
      if (s === undefined) {
        say(`device ${d.index}: feature ${f.id} is not on the server`);
        continue;
      }
      if (s.type !== f.type || s.lifecycle !== f.lifecycle)
        say(`device ${d.index}: feature ${f.id} differs from the server row in type or deletion`);
      for (const [k, value] of Object.entries(f.properties))
        if (!same(value, s.properties[k]))
          say(`device ${d.index}: feature ${f.id} property ${k} differs from the server`);
    }
  }
}

/** Runs this device shows as refused (drafts kept for the user), by run id. */
function refusedOn(devices: readonly RealDevice[]): Map<RunId, string> {
  const out = new Map<RunId, string>();
  for (const d of devices) for (const r of d.queue.status().refused) out.set(r.runId, r.refusal.code);
  return out;
}

function noAcceptedRunLost({ audit, devices, submitted }: RealCheckInput, v: Violation[]): void {
  const say = (detail: string): number => v.push({ invariant: 'no_accepted_run_lost', detail });
  const refused = refusedOn(devices);
  const perRun = new Map<RunId, number>();
  for (const o of audit.observations) perRun.set(o.runId, (perRun.get(o.runId) ?? 0) + 1);

  for (const [id, run] of submitted) {
    const row = audit.runs.get(id);
    if (row === undefined) {
      if (!refused.has(id)) say(`run ${id} vanished: not on the server, refused or queued`);
    } else if (row.outcome === 'accepted') {
      if (refused.has(id)) say(`run ${id} is accepted on the server but shown as refused on a device`);
    } else if (!refused.has(id) && run.actor.kind !== 'admin') {
      say(`refused run ${id} is not visible as refused on any device`);
    }
  }
  for (const d of devices) {
    if (d.livePending() > 0)
      say(`device ${d.index} still holds ${d.livePending()} unsent or unconfirmed runs after the drain`);
    const review = d.queue.status().review;
    if (review.length > 0)
      say(`device ${d.index} holds ${review.length} runs for review: the config version was never gone`);
  }
}

function refusalsLeaveNoTrace({ audit, devices }: RealCheckInput, v: Violation[]): void {
  const say = (detail: string): number => v.push({ invariant: 'refusal_leaves_no_trace', detail });
  const refused = refusedOn(devices);
  for (const o of audit.observations) {
    const row = audit.runs.get(o.runId);
    if (refused.has(o.runId)) say(`refused run ${o.runId} left observation seq ${o.seq}`);
    if (row?.outcome === 'rejected') say(`rejected run ${o.runId} left observation seq ${o.seq}`);
    if (row === undefined)
      say(`observation seq ${o.seq} belongs to run ${o.runId}, which the server has no row for`);
  }
  const seqs = [...audit.observations.map((o) => o.seq), ...audit.tombstoneSeqs].sort((a, b) => a - b);
  seqs.forEach((s, i) => {
    if (s !== i + 1) say(`seq gap: position ${i} holds seq ${s}`);
  });
  for (const m of audit.foldMismatches) say(`state differs from the fold of the accepted log: ${m}`);
}
