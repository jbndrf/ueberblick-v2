/**
 * Row readers of the sync service: features, observations, edges and tombstones as the protocol wants them, clipped
 * by a `Scope`. Every statement uses an index (features and edges by `updated_seq`, observations by feature, edges by
 * end) and only touches the rows of one page (R14).
 */
import {
  SYNC_OBSERVATION_HISTORY,
  type FeatureId,
  type LifecycleState,
  type Instant,
  type Json,
  type Key,
  type RunId,
  type SyncEdge,
  type SyncFeature,
  type SyncObservation,
  type SyncTombstone,
} from '@ueberblick/core';
import type { Db } from '../db/driver';
import { auditFromRow } from '../store/facts/facts';
import type { LiveScope } from './live';
import { seesNames } from './runs';
import type { Predicate, Scope } from './visibility';

export interface FeatureRow {
  readonly id: string;
  readonly type: string;
  readonly properties: string;
  readonly updated_seq: number;
  readonly pinned_version: number | null;
  readonly lifecycle: string;
  readonly created_by: string | null;
  readonly created_at: string | null;
  readonly changed_at: string | null;
  readonly vis?: number;
}

/** The `features` columns a sync page reads, qualified with the alias `sf` (the shape of `FeatureRow`). */
export const SYNC_FEATURE_COLUMNS =
  'sf.id, sf.type, sf.properties, sf.updated_seq, sf.pinned_version, sf.lifecycle, sf.created_by, sf.created_at, sf.changed_at';

/** The properties of a stored feature the scope may read. */
export function visibleProperties(scope: Scope, type: string, json: string): { [k: string]: Json } {
  const all = JSON.parse(json) as { [k: string]: Json };
  const ok = scope.readable(type);
  const out: { [k: string]: Json } = {};
  for (const k of Object.keys(all)) if (ok.has(k)) out[k] = all[k] as Json;
  return out;
}

/** The row as sent: its properties clipped by the permissions of the version it follows, which it carries. */
export const toSyncFeature = (scope: LiveScope, r: FeatureRow): SyncFeature => {
  const version = scope.versionOf(r.pinned_version);
  // The creator is clipped like a run's actor (`readRuns`): with activity names off only the receiver's own stay.
  const audit = auditFromRow(r);
  const { createdBy, ...rest } = audit;
  const shown = createdBy === undefined || seesNames(scope) || createdBy === scope.actor.id ? audit : rest;
  return {
    id: r.id as FeatureId,
    type: r.type as Key,
    version,
    properties: visibleProperties(scope.at(version), r.type, r.properties),
    lifecycle: r.lifecycle as LifecycleState,
    ...shown,
    updatedSeq: r.updated_seq,
  };
};

const ids = (list: readonly string[]): string => JSON.stringify(list);
const IN_IDS = '(SELECT value FROM json_each(?))';
const params = (...p: (readonly Json[] | Json)[]): (string | number)[] =>
  p.flat() as unknown as (string | number)[];

/** Last `SYNC_OBSERVATION_HISTORY` observations per (feature, property) up to `upTo`, readable properties only. */
export function readObservations(
  db: Db,
  scope: LiveScope,
  features: readonly { readonly id: string; readonly type: string; readonly pinned_version: number | null }[],
  upTo: number,
): SyncObservation[] {
  if (features.length === 0) return [];
  const typeOf = new Map(features.map((f) => [f.id, f.type]));
  const scopeOf = new Map(features.map((f) => [f.id, scope.at(scope.versionOf(f.pinned_version))]));
  const rows = db
    .prepare<{
      feature_id: string;
      property: string;
      result: string | null;
      phenomenon_time: string | null;
      result_time: string | null;
      seq: number;
      run_id: string;
    }>(
      `SELECT feature_id, property, result, phenomenon_time, result_time, seq, run_id FROM (
         SELECT o.*, row_number() OVER (PARTITION BY o.feature_id, o.property ORDER BY o.seq DESC) AS rn
         FROM observations o
         WHERE o.feature_id IN ${IN_IDS} AND o.seq <= ? AND substr(o.property, 1, 1) != '$')
       WHERE rn <= ${SYNC_OBSERVATION_HISTORY} ORDER BY seq`,
    )
    .all(ids(features.map((f) => f.id)), upTo);
  const out: SyncObservation[] = [];
  for (const r of rows) {
    if (
      !scopeOf
        .get(r.feature_id)
        ?.readable(typeOf.get(r.feature_id) ?? '')
        .has(r.property)
    )
      continue;
    out.push({
      featureId: r.feature_id as FeatureId,
      property: r.property,
      result: (r.result === null ? null : JSON.parse(r.result)) as Json,
      phenomenonTime: r.phenomenon_time as Instant | null,
      resultTime: r.result_time as Instant | null,
      seq: r.seq,
      runId: r.run_id as RunId,
    });
  }
  return out;
}

/** A `WHERE` condition on `edges e` and its parameters. */
interface EdgeCond {
  readonly sql: string;
  readonly p: readonly (string | number)[];
}

/** Edges with an end in `list`, updated up to `hi` (a snapshot pinned at `hi`). */
export const edgesOfFrom = (list: readonly string[], hi: number): EdgeCond => ({
  sql: `e.from_id IN ${IN_IDS} AND e.updated_seq <= ?`,
  p: [ids(list), hi],
});
export const edgesOfTo = (list: readonly string[], hi: number): EdgeCond => ({
  sql: `e.to_id IN ${IN_IDS} AND e.updated_seq <= ?`,
  p: [ids(list), hi],
});
/** Edges written in `(lo, hi]`. */
export const edgesInWindow = (lo: number, hi: number): EdgeCond => ({
  sql: 'e.updated_seq > ? AND e.updated_seq <= ?',
  p: [lo, hi],
});

/** Edges selected by `cond` whose two ends the scope sees, minus relations that would reveal a hidden property. */
export function readEdges(db: Db, scope: LiveScope, now: Instant, cond: EdgeCond): SyncEdge[] {
  const from: Predicate = scope.visibleSql('sf', now);
  const to: Predicate = scope.visibleSql('st', now);
  const rows = db
    .prepare<{
      from_id: string;
      relation: string;
      to_id: string;
      derived: number;
      updated_seq: number;
      from_type: string;
      from_pinned: number | null;
    }>(
      `SELECT e.from_id, e.relation, e.to_id, e.derived, e.updated_seq, sf.type AS from_type, sf.pinned_version AS from_pinned
       FROM edges e JOIN features sf ON sf.id = e.from_id JOIN features st ON st.id = e.to_id
       WHERE ${cond.sql} AND ${from.sql} AND ${to.sql}`,
    )
    .all(...params(cond.p, from.params, to.params));
  return rows
    .filter((r) => !scope.at(scope.versionOf(r.from_pinned)).hidesRelation(r.from_type, r.relation))
    .map((r) => ({
      from: r.from_id as FeatureId,
      relation: r.relation as Key,
      to: r.to_id as FeatureId,
      derived: r.derived === 1,
      updatedSeq: r.updated_seq,
    }));
}

/** Of `list`, the features the scope sees now, with their types and the scope of the version each follows. */
export function visibleAmong(
  db: Db,
  scope: LiveScope,
  now: Instant,
  list: readonly string[],
): Map<string, { readonly type: string; readonly scope: Scope }> {
  const out = new Map<string, { readonly type: string; readonly scope: Scope }>();
  if (list.length === 0) return out;
  const vis = scope.visibleSql('sf', now);
  const rows = db
    .prepare<{ id: string; type: string; pinned_version: number | null }>(
      `SELECT sf.id, sf.type, sf.pinned_version FROM features sf WHERE sf.id IN ${IN_IDS} AND ${vis.sql}`,
    )
    .all(...params(ids(list), vis.params));
  for (const r of rows) out.set(r.id, { type: r.type, scope: scope.at(scope.versionOf(r.pinned_version)) });
  return out;
}

/** Stored tombstones in `(lo, hi]` that this scope may learn about (features are tombstoned by the caller). */
export function readTombstones(
  db: Db,
  scope: LiveScope,
  now: Instant,
  lo: number,
  hi: number,
): SyncTombstone[] {
  const rows = db
    .prepare<{ seq: number; kind: string; id: string }>(
      'SELECT seq, kind, id FROM tombstones WHERE seq > ? AND seq <= ? ORDER BY seq',
    )
    .all(lo, hi);
  const named = new Set<string>();
  const split = new Map<string, string[]>();
  for (const r of rows) {
    if (r.kind === 'edge') {
      const parts = r.id.split('\u0000');
      split.set(r.id, parts);
      if (parts[0] !== undefined) named.add(parts[0]);
      if (parts[2] !== undefined) named.add(parts[2]);
    } else if (r.kind === 'redaction') named.add(r.id.slice(0, r.id.indexOf('#')));
  }
  const seen = visibleAmong(db, scope, now, [...named]);
  const out: SyncTombstone[] = [];
  for (const r of rows) {
    if (r.kind === 'blob') out.push({ seq: r.seq, kind: 'blob', id: r.id });
    else if (r.kind === 'edge') {
      const [from, relation, to] = split.get(r.id) ?? [];
      const end = from === undefined ? undefined : seen.get(from);
      if (
        end !== undefined &&
        to !== undefined &&
        seen.has(to) &&
        !end.scope.hidesRelation(end.type, relation ?? '')
      )
        out.push({ seq: r.seq, kind: 'edge', id: r.id });
    } else if (r.kind === 'redaction') {
      const at = r.id.indexOf('#');
      const end = seen.get(r.id.slice(0, at));
      if (end !== undefined && end.scope.readable(end.type).has(r.id.slice(at + 1)))
        out.push({ seq: r.seq, kind: 'redaction', id: r.id });
    }
  }
  return out;
}
