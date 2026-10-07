import type { Edge, FeatureId, Key } from '@ueberblick/core';
import { liveEdgeJoin } from '@ueberblick/core/expr/compile';
import type { Db } from '../../db/driver';

interface EdgeRow {
  from_id: string;
  relation: string;
  to_id: string;
  derived: number;
}

export const toEdge = (r: EdgeRow): Edge => ({
  from: r.from_id as FeatureId,
  relation: r.relation as Key,
  to: r.to_id as FeatureId,
  derived: r.derived === 1,
});

const COLUMNS = 'e.from_id, e.relation, e.to_id, e.derived';

/**
 * "The far end is a live feature" is core's `liveEdgeJoin`, the text `relationFrom` in the rule language translation
 * builds on too (R1). `related.conformance.spec.ts` holds the two to equal results on random worlds.
 */
const liveSelect = (direction: 'out' | 'in', byRelation: boolean, order: string): string => {
  const j = liveEdgeJoin({ edge: 'e', feature: 'f', direction });
  const rel = byRelation ? ' AND e.relation = ?' : '';
  return `SELECT ${COLUMNS} FROM edges e ${j.join} WHERE e.${j.near} = ?${rel} AND ${j.live} ORDER BY ${order}`;
};

/** Edge reads over the `edges` indexes. `live` follows relation semantics; `stored` returns every edge row (the fold's view). */
export interface EdgeReads {
  from(id: FeatureId, relation?: Key): readonly Edge[];
  to(id: FeatureId, relation?: Key): readonly Edge[];
}

/** Edges whose far end is a live feature: what `Facts.edgesFrom` / `edgesTo` return. */
export function liveEdges(db: Db): EdgeReads {
  const from = db.prepare<EdgeRow>(liveSelect('out', false, 'e.relation, e.to_id'));
  const fromRel = db.prepare<EdgeRow>(liveSelect('out', true, 'e.to_id'));
  const to = db.prepare<EdgeRow>(liveSelect('in', false, 'e.relation, e.from_id'));
  const toRel = db.prepare<EdgeRow>(liveSelect('in', true, 'e.from_id'));
  return {
    from: (id, relation) => (relation === undefined ? from.all(id) : fromRel.all(id, relation)).map(toEdge),
    to: (id, relation) => (relation === undefined ? to.all(id) : toRel.all(id, relation)).map(toEdge),
  };
}

/** Every stored edge row, dead far ends included: `core.fold` needs them to remove derived edges that no longer hold. */
export function storedEdges(db: Db): EdgeReads {
  const from = db.prepare<EdgeRow>(
    'SELECT from_id, relation, to_id, derived FROM edges WHERE from_id = ? ORDER BY relation, to_id',
  );
  const fromRel = db.prepare<EdgeRow>(
    'SELECT from_id, relation, to_id, derived FROM edges WHERE from_id = ? AND relation = ? ORDER BY to_id',
  );
  const to = db.prepare<EdgeRow>(
    'SELECT from_id, relation, to_id, derived FROM edges WHERE to_id = ? ORDER BY relation, from_id',
  );
  const toRel = db.prepare<EdgeRow>(
    'SELECT from_id, relation, to_id, derived FROM edges WHERE to_id = ? AND relation = ? ORDER BY from_id',
  );
  return {
    from: (id, relation) => (relation === undefined ? from.all(id) : fromRel.all(id, relation)).map(toEdge),
    to: (id, relation) => (relation === undefined ? to.all(id) : toRel.all(id, relation)).map(toEdge),
  };
}
