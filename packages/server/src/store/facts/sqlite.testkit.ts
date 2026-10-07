/**
 * SQLite helpers for the facts specs: a project database, the fold pipeline of the run transaction over it, table dumps.
 * The shared fixtures and the reference model live in core (`factsKit` of `@ueberblick/core/testing`, WP-146).
 */
import { createFold, createGeo, type Edge, type FeatureId, type FoldedFeature } from '@ueberblick/core';
import { factsKit } from '@ueberblick/core/testing';
import type { RecordedObservation } from '@ueberblick/core';
import { openProjectDb } from '../../db/open';
import type { Db } from '../../db/driver';
import type { InverseRelations } from '../contract';
import { createFoldWriter } from './apply';
import { createDerivedLookup } from './lookup';

export const { k, fid, SCHEMA, point, square, ob, Model, IDS, op, toLog } = factsKit;
export type Model = InstanceType<typeof factsKit.Model>;

/** `plot.trees` is the inverse of `tree.plot`; `area.trees` reads the derived `area_of` backwards. */
export const INVERSE: InverseRelations = new Map([
  ['plot.trees', { key: 'plot', from: 'tree' }],
  ['area.trees', { key: 'area_of', from: 'tree' }],
]);
/** The same relations as core's `SqlMapping.inverse` takes them (stored key only). */
export const SQL_INVERSE: ReadonlyMap<string, string> = new Map(
  [...INVERSE].map(([name, r]) => [name, r.key]),
);

export function openDb(): Db {
  const db = openProjectDb(':memory:', 'test');
  db.prepare(
    `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome)
     VALUES ('r1', 'u1', 'participant', 't', 1, '{}', '2026-01-01T00:00:00.000Z', 'accepted')`,
  ).run();
  return db;
}

/** Stores observations in the log table (history reads them). */
export function logObservations(db: Db, obs: readonly RecordedObservation[]): void {
  const put = db.prepare(
    'INSERT INTO observations (seq, run_id, feature_id, property, result, phenomenon_time) VALUES (?, ?, ?, ?, ?, NULL)',
  );
  db.transaction(() => {
    for (const o of obs) put.run(o.seq, o.runId, o.featureId, o.property, JSON.stringify(o.result));
  });
}

const geo = createGeo();
const fold = createFold(geo);

/**
 * Folds `obs` (ascending seq) in chunks of `chunk` observations into `db`: the fold pipeline of the run
 * transaction (WP-104), reduced to what the read side needs. `model` is the previous state per feature; it is
 * updated with the same observations (its own fold and derived recomputation), so it stays the reference.
 */
export function ingest(db: Db, model: Model, obs: readonly RecordedObservation[], chunk: number): void {
  logObservations(db, obs);
  const writer = createFoldWriter(db);
  const lookup = createDerivedLookup(db, SCHEMA, geo, () => {
    throw new Error('the test schema has no derive condition');
  });
  for (let i = 0; i < obs.length; i += chunk) {
    const slice = obs.slice(i, i + chunk);
    const byFeature = new Map<FeatureId, RecordedObservation[]>();
    for (const o of slice) byFeature.set(o.featureId, [...(byFeature.get(o.featureId) ?? []), o]);
    const features: FoldedFeature[] = [];
    const put: Edge[] = [];
    const remove: Edge[] = [];
    const moved: FoldedFeature[] = [];
    for (const [id, list] of byFeature) {
      const r = fold.feature(model.features.get(id), list, SCHEMA);
      if (!r.feature) continue;
      features.push(r.feature);
      put.push(...r.edges.put);
      remove.push(...r.edges.remove);
      if (r.geometryChanged.length > 0) moved.push(r.feature);
    }
    const seq = (slice[slice.length - 1] as RecordedObservation).seq;
    writer.apply({ configVersion: 1, schema: SCHEMA, features, edges: { put, remove }, seq });
    model.apply(slice);
    for (const f of moved) {
      const changes = fold.recomputeDerived(f, lookup, SCHEMA);
      writer.apply({ configVersion: 1, schema: SCHEMA, features: [], edges: changes, seq });
    }
  }
}

/** Canonical dump of the three tables (rowids replaced by feature ids), for equality checks. */
export function dump(db: Db): string {
  const rows = (sql: string): unknown[] => db.prepare(sql).all();
  return JSON.stringify({
    features: rows('SELECT * FROM features ORDER BY id'),
    edges: rows('SELECT from_id, relation, to_id, derived FROM edges ORDER BY from_id, relation, to_id'),
    bbox: rows(
      'SELECT f.id, r.minx, r.maxx, r.miny, r.maxy FROM feature_bbox r JOIN features f ON f.rowid = r.rid ORDER BY f.id',
    ),
    orphans: rows('SELECT rid FROM feature_bbox WHERE rid NOT IN (SELECT rowid FROM features)'),
  });
}
