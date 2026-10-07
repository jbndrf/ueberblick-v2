/**
 * Audit metadata of a feature (A-028 item 3): derived by fold from the observations, so the device and the server
 * agree (R1). `$created_by` is written once by plan on create (`creatorOf`); the times are the `resultTime`s
 * (server receive time, as v3's created/updated; WP-794). A prediction a device has not synced has none yet and
 * shows its `phenomenonTime`, the device time, as v3 did before sync (`gateway.svelte.ts:466-474, 505-508`).
 */
import { AUDIT_CLOCK_SKEW_MS, AUDIT_MAX_OFFLINE_AGE_MS } from '../registry/limits';
import type { FeatureAudit, Instant, RecordedObservation, Run } from '../model';

export const RESERVED_CREATED_BY = '$created_by';

/** The one place that says who created what a run creates: the actor of the run (R1). */
export const creatorOf = (run: Pick<Run, 'actor'>): string => run.actor.id;

type AuditInput = Pick<RecordedObservation, 'property' | 'result' | 'phenomenonTime' | 'resultTime'>;

/** `audit` after one more observation (ascending seq): the creator once, the creation time from `$type`, the newest time. */
export function foldAudit(audit: FeatureAudit, o: AuditInput): FeatureAudit {
  const at: Instant | undefined = o.resultTime ?? o.phenomenonTime;
  let next = audit;
  if (o.property === RESERVED_CREATED_BY && audit.createdBy === undefined && typeof o.result === 'string')
    next = { ...next, createdBy: o.result };
  if (o.property === '$type' && audit.createdAt === undefined && at !== undefined)
    next = { ...next, createdAt: at };
  if (at !== undefined && at !== audit.changedAt) next = { ...next, changedAt: at };
  return next;
}

/**
 * The `resultTime` the intake stamps on every observation of a run (R1, the one place): the time the server received
 * the run. An import (and so the v3 migration) keeps its historical client time, so migrated features keep their v3
 * created and updated times; `runs.received_at` stays the arrival time.
 */
export const resultTimeOf = (run: Pick<Run, 'actor' | 'clientTime'>, receivedAt: Instant): Instant =>
  run.actor.kind === 'import' && run.clientTime !== undefined ? run.clientTime : receivedAt;

/** The audit fields of a state, only those that are set (no `undefined` values under exactOptionalPropertyTypes). */
export const auditOf = (f: FeatureAudit): FeatureAudit => ({
  ...(f.createdBy !== undefined ? { createdBy: f.createdBy } : {}),
  ...(f.createdAt !== undefined ? { createdAt: f.createdAt } : {}),
  ...(f.changedAt !== undefined ? { changedAt: f.changedAt } : {}),
});

/**
 * The client time a run may carry into the audit times: inside `[receivedAt - MAX_OFFLINE_AGE, receivedAt + SKEW]`.
 * An unparseable time becomes `receivedAt`. The one rule of the intake (R1, R3).
 */
export function clampClientTime(clientTime: Instant, receivedAt: Instant): Instant {
  const server = Date.parse(receivedAt);
  const client = Date.parse(clientTime);
  if (Number.isNaN(server)) return clientTime;
  if (Number.isNaN(client)) return receivedAt;
  if (client > server + AUDIT_CLOCK_SKEW_MS)
    return new Date(server + AUDIT_CLOCK_SKEW_MS).toISOString() as Instant;
  if (client < server - AUDIT_MAX_OFFLINE_AGE_MS)
    return new Date(server - AUDIT_MAX_OFFLINE_AGE_MS).toISOString() as Instant;
  return clientTime;
}
