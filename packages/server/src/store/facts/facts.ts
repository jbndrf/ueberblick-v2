import type {
  Bbox,
  FeatureAudit,
  FeatureId,
  FeatureState,
  Json,
  Key,
  LifecycleState,
  RecordedObservation,
  RunId,
} from '@ueberblick/core';
import { servedSql, readSystemField } from '@ueberblick/core';
import { liveEdgeJoin, viewportFrom } from '@ueberblick/core/expr/compile';
import type { Db } from '../../db/driver';
import type { InverseRelations, ServerFacts } from '../contract';
import { liveEdges } from './edges';

const SERVED = servedSql('lifecycle');
const VIEWPORT = viewportFrom({ feature: 'f', box: 'r' });

interface FeatureRow {
  id: string;
  type: string;
  properties: string;
  updated_seq: number;
  lifecycle: string;
  created_by: string | null;
  created_at: string | null;
  changed_at: string | null;
  pinned_version: number | null;
}
interface ObsRow {
  seq: number;
  run_id: string;
  result: string | null;
  phenomenon_time: string | null;
  result_time: string | null;
}

/** The audit columns of a `features` row as `FeatureAudit` fields; a null column leaves the field out. */
export const auditFromRow = (r: {
  readonly created_by: string | null;
  readonly created_at: string | null;
  readonly changed_at: string | null;
}): FeatureAudit => ({
  ...(r.created_by === null ? {} : { createdBy: r.created_by }),
  ...(r.created_at === null ? {} : { createdAt: r.created_at }),
  ...(r.changed_at === null ? {} : { changedAt: r.changed_at }),
});

export const toFeatureState = (r: FeatureRow): FeatureState => ({
  id: r.id as FeatureId,
  type: r.type as Key,
  properties: JSON.parse(r.properties) as FeatureState['properties'],
  lifecycle: r.lifecycle as LifecycleState,
  ...auditFromRow(r),
  ...(r.pinned_version === null ? {} : { pinnedVersion: r.pinned_version }),
  updatedSeq: r.updated_seq,
});

export const FEATURE_COLUMNS =
  'id, type, properties, updated_seq, lifecycle, created_by, created_at, changed_at, pinned_version';

const sourcesJoin = liveEdgeJoin({ edge: 'e', feature: 'f', direction: 'in' });
/**
 * The sources of an inverse relation: the stored edges into the feature, by the far feature's type. `+f.type` keeps the
 * type filter off the `features` indexes: with a plain `f.type = ?` the planner scanned every feature of that type and
 * probed the edges per feature (35 ms p95 at 60k, budget 1 ms). The edge side is one covering `edges_by_to` search.
 */
export const SOURCES_SQL = `SELECT e.${sourcesJoin.far} FROM edges e ${sourcesJoin.join}
     WHERE e.${sourcesJoin.near} = ? AND e.relation = ? AND ${sourcesJoin.live} AND +f.type = ? ORDER BY e.${sourcesJoin.far}`;

/** Facts + FeatureAccess over the WP-100 tables; every statement is prepared once and uses an index. */
export function createFacts(db: Db, inverse: InverseRelations): ServerFacts {
  const feature = db.prepare<FeatureRow>(`SELECT ${FEATURE_COLUMNS} FROM features WHERE id = ?`);
  const type = db.prepare<{ type: string }>('SELECT type FROM features WHERE id = ?');
  const props = db.prepare<{ properties: string }>('SELECT properties FROM features WHERE id = ?');
  const edges = liveEdges(db);
  // Relation set = core's SQL translation (expr/sql/values.ts relationFrom): the far end must exist and be live.
  const out = liveEdgeJoin({ edge: 'e', feature: 'f', direction: 'out' });
  const targets = db.prepare<{ to_id: string }>(
    `SELECT e.${out.far} FROM edges e ${out.join}
     WHERE e.${out.near} = ? AND e.relation = ? AND ${out.live} ORDER BY e.${out.far}`,
  );
  const sources = db.prepare<{ from_id: string }>(SOURCES_SQL);
  const near = db.prepare<FeatureRow>(
    `SELECT ${FEATURE_COLUMNS.split(', ')
      .map((c) => `f.${c}`)
      .join(', ')} ${VIEWPORT.from}
     WHERE ${VIEWPORT.near} AND f.type = ?`,
  );
  const history = db.prepare<ObsRow>(
    `SELECT seq, run_id, result, phenomenon_time, result_time FROM observations
     WHERE feature_id = ? AND property = ? ORDER BY seq DESC LIMIT ?`,
  );
  // Erasure (B-005): the runs(actor) index finds the runs, observations are read per run.
  const byActor = db.prepare<ObsRow & { feature_id: string; property: string }>(
    `SELECT o.seq, o.run_id, o.feature_id, o.property, o.result, o.phenomenon_time, o.result_time
     FROM runs r JOIN observations o ON o.run_id = r.id WHERE r.actor = ? ORDER BY o.seq`,
  );
  // The creation quota (WP-639) counts the features a creator made (`features.created_by`, WP-306); the index range of one
  // creator stops at the limit, so the cost is bounded by it and never scans.
  const created = db.prepare<{ n: number }>(
    `SELECT COUNT(*) AS n FROM (
       SELECT 1 FROM features WHERE created_by = ? AND lifecycle <> 'deleted' LIMIT ?)`,
  );
  const withValue = db.prepare<FeatureRow>(
    `SELECT ${FEATURE_COLUMNS} FROM features
     WHERE type = ? AND ${SERVED} AND json_extract(properties, ?) IS json_extract(?, '$') ORDER BY id`,
  );

  const ofType = db.prepare<FeatureRow>(
    `SELECT ${FEATURE_COLUMNS} FROM features WHERE type = ? AND ${SERVED} ORDER BY id`,
  );

  return {
    observationsByActor: (actorId): readonly RecordedObservation[] =>
      byActor.all(actorId).map((r) => ({
        featureId: r.feature_id as FeatureId,
        property: r.property,
        result: (r.result === null ? null : JSON.parse(r.result)) as Json,
        seq: r.seq,
        runId: r.run_id as RunId,
        ...(r.phenomenon_time === null ? {} : { phenomenonTime: r.phenomenon_time }),
        ...(r.result_time === null ? {} : { resultTime: r.result_time }),
      })),
    createdBy: (actorId, limit): number => (limit <= 0 ? 0 : (created.get(actorId, limit)?.n ?? 0)),
    featuresWith: (t: Key, property, value): Iterable<FeatureState> =>
      withValue.all(t, `$."${property.replaceAll('"', '')}"`, JSON.stringify(value)).map(toFeatureState),
    ofType: (t: Key): Iterable<FeatureState> => ofType.all(t).map(toFeatureState),
    feature(id): FeatureState | undefined {
      const r = feature.get(id);
      return r ? toFeatureState(r) : undefined;
    },
    near: (t: Key, b: Bbox): Iterable<FeatureState> => near.all(...VIEWPORT.args(b), t).map(toFeatureState),
    edgesFrom: edges.from,
    edgesTo: edges.to,
    history(id, property, limit): readonly RecordedObservation[] {
      if (limit <= 0) return [];
      return history.all(id, property, limit).map((r) => ({
        featureId: id,
        property,
        result: (r.result === null ? null : JSON.parse(r.result)) as Json,
        seq: r.seq,
        runId: r.run_id as RunId,
        ...(r.phenomenon_time === null ? {} : { phenomenonTime: r.phenomenon_time }),
        ...(r.result_time === null ? {} : { resultTime: r.result_time }),
      }));
    },
    property(id, key): Json | undefined {
      if (key.startsWith('$')) {
        const r = feature.get(id);
        return r === undefined ? undefined : readSystemField(toFeatureState(r), key);
      }
      const r = props.get(id);
      return r ? (JSON.parse(r.properties) as { [k: string]: Json })[key] : undefined;
    },
    related(id, relation): readonly FeatureId[] {
      const t = type.get(id)?.type;
      if (t === undefined) return [];
      const stored = inverse.get(`${t}.${relation}`);
      return stored === undefined
        ? targets.all(id, relation).map((r) => r.to_id as FeatureId)
        : sources.all(id, stored.key, stored.from).map((r) => r.from_id as FeatureId);
    },
    type: (id) => type.get(id)?.type as Key | undefined,
  };
}
