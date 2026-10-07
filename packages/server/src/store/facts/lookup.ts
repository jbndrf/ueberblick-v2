import type {
  Bbox,
  Derived,
  DerivedLookup,
  FeatureId,
  FoldedFeature,
  FoldSchema,
  Geo,
  Geometry,
  Key,
} from '@ueberblick/core';
import { viewportFrom } from '@ueberblick/core/expr/compile';
import type { Db } from '../../db/driver';
import type { BboxHit } from '../contract';
import { storedEdges } from './edges';
import { FEATURE_COLUMNS, toFeatureState } from './facts';

/** The one text of a viewport (core, WP-590): the R*Tree drives, `features` is fetched by rowid. */
const VIEWPORT = viewportFrom({ feature: 'f', box: 'r' });

/** Live features whose bbox intersects `bbox`, optionally of one type; ordered by id. */
export function bboxQuery(db: Db, bbox: Bbox, type?: string): readonly BboxHit[] {
  const sql = `SELECT f.id AS id, f.type AS type ${VIEWPORT.from}
    WHERE ${VIEWPORT.near}${type === undefined ? '' : ' AND f.type = ?'} ORDER BY f.id`;
  const args = [...VIEWPORT.args(bbox)];
  return db
    .prepare<{ id: string; type: string }>(sql)
    .all(...(type === undefined ? args : [...args, type]))
    .map((r) => ({ id: r.id as FeatureId, type: r.type }));
}

const isGeometry = (v: unknown): v is Geometry =>
  typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';

const featureRow = FEATURE_COLUMNS.split(', ')
  .map((c) => `f.${c}`)
  .join(', ');

/** `condition` is the caller's expr.condition over its Facts (the run transaction owns compiled expressions). */
export function createDerivedLookup(
  db: Db,
  schema: FoldSchema,
  geo: Geo,
  condition: DerivedLookup['condition'],
): DerivedLookup {
  const near = db.prepare<Parameters<typeof toFeatureState>[0]>(
    `SELECT ${featureRow} ${VIEWPORT.from} WHERE ${VIEWPORT.near} AND f.type = ?`,
  );
  const edges = storedEdges(db); // the fold removes derived edges by comparing with what is stored, dead ends included
  const deriving = new Map<Key, Key[]>();
  for (const [t, ft] of schema.types)
    for (const d of ft.derived) deriving.set(d.to, [...(deriving.get(d.to) ?? []), t]);

  return {
    near(type, bbox): Iterable<FoldedFeature> {
      return near.all(...VIEWPORT.args(bbox), type).map((r): FoldedFeature => {
        const state = toFeatureState(r);
        const derived: { [p: string]: Derived } = {};
        for (const p of schema.types.get(state.type)?.geometryProperties ?? []) {
          const g = state.properties[p];
          if (isGeometry(g)) derived[p] = geo.derive(g);
        }
        return { ...state, derived };
      });
    },
    condition,
    typesDerivingTo: (type) => deriving.get(type) ?? [],
    edgesFrom: (id: FeatureId, relation: Key) => edges.from(id, relation),
    edgesTo: (id: FeatureId, relation: Key) => edges.to(id, relation),
  };
}
