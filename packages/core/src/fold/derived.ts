/**
 * Derived edges (F9): `predicate(self.<prop>, other.<prop>)` plus an optional full condition, recomputed
 * in both directions. The predicate prefilters through the bbox index; the condition decides.
 */
import type { Bbox, Geo, Geometry } from '../geo';
import { bboxIntersects, bboxOfCached } from '../geo/bbox';
import type { Edge, FeatureId, Key } from '../model';
import type { DerivedLookup, EdgeChanges, FoldDerivedRelation, FoldedFeature, FoldSchema } from './contract';
import { edgeKey } from './edge-key';
import { isGeometry } from './state';
import { isServed } from '../registry/lifecycle';

/** Diff a wanted set of derived edges against the stored ones (of one relation). */
function diff(
  existing: readonly Edge[],
  wanted: readonly Edge[],
  into: { put: Edge[]; remove: Edge[] },
): void {
  const have = new Set<string>();
  for (const e of existing) if (e.derived) have.add(edgeKey(e));
  const want = new Set(wanted.map(edgeKey));
  for (const e of wanted) if (!have.has(edgeKey(e))) into.put.push(e);
  for (const e of existing) if (e.derived && !want.has(edgeKey(e))) into.remove.push(e);
}

const geometryOf = (f: FoldedFeature, property: Key): Geometry | undefined => {
  const v = f.properties[property];
  return isGeometry(v) ? v : undefined;
};

/** Cheap reject before the predicate: every predicate but `disjoint` needs the bboxes to intersect. */
function bboxesMeet(
  predicate: FoldDerivedRelation['predicate'],
  box: Bbox,
  other: FoldedFeature,
  property: Key,
  g: Geometry,
): boolean {
  if (predicate === 'disjoint') return true;
  const ob = other.derived[property]?.bbox ?? bboxOfCached(g);
  return ob === undefined || bboxIntersects(box, ob);
}

/** The full condition, when the relation has one; the spatial predicate alone otherwise (already tested). */
function holds(
  lookup: DerivedLookup,
  rel: FoldDerivedRelation,
  self: FoldedFeature,
  other: FoldedFeature,
): boolean {
  return rel.condition === undefined || lookup.condition(rel.condition, self, other);
}

export function recomputeDerived(
  geo: Geo,
  feature: FoldedFeature,
  lookup: DerivedLookup,
  schema: FoldSchema,
): EdgeChanges {
  const out = { put: [] as Edge[], remove: [] as Edge[] };
  const live = isServed(feature.lifecycle);
  const edge = (from: FeatureId, relation: Key, to: FeatureId): Edge => ({
    from,
    relation,
    to,
    derived: true,
  });

  // Forward: this feature is `self`.
  for (const rel of schema.types.get(feature.type)?.derived ?? []) {
    const wanted: Edge[] = [];
    const self = live ? geometryOf(feature, rel.selfProperty) : undefined;
    const box = feature.derived[rel.selfProperty]?.bbox;
    if (self && box) {
      for (const other of lookup.near(rel.to, box)) {
        if (other.id === feature.id || !isServed(other.lifecycle)) continue;
        const g = geometryOf(other, rel.otherProperty);
        if (
          g &&
          bboxesMeet(rel.predicate, box, other, rel.otherProperty, g) &&
          geo.test(rel.predicate, self, g) &&
          holds(lookup, rel, feature, other)
        )
          wanted.push(edge(feature.id, rel.relation, other.id));
      }
    }
    diff(lookup.edgesFrom(feature.id, rel.relation), wanted, out);
  }

  // Reverse: this feature is `other` for every type that derives to its type.
  for (const type of lookup.typesDerivingTo(feature.type)) {
    for (const rel of schema.types.get(type)?.derived ?? []) {
      if (rel.to !== feature.type) continue;
      const wanted: Edge[] = [];
      const mine = live ? geometryOf(feature, rel.otherProperty) : undefined;
      const box = feature.derived[rel.otherProperty]?.bbox;
      if (mine && box) {
        for (const selfF of lookup.near(type, box)) {
          if (selfF.id === feature.id || !isServed(selfF.lifecycle)) continue;
          const g = geometryOf(selfF, rel.selfProperty);
          if (
            g &&
            bboxesMeet(rel.predicate, box, selfF, rel.selfProperty, g) &&
            geo.test(rel.predicate, g, mine) &&
            holds(lookup, rel, selfF, feature)
          )
            wanted.push(edge(selfF.id, rel.relation, feature.id));
        }
      }
      diff(lookup.edgesTo(feature.id, rel.relation), wanted, out);
    }
  }
  return dedupe(out);
}

function dedupe(c: { put: Edge[]; remove: Edge[] }): EdgeChanges {
  const seen = new Set<string>();
  const uniq = (list: Edge[]): Edge[] => list.filter((e) => !seen.has(edgeKey(e)) && seen.add(edgeKey(e)));
  const remove = uniq(c.remove);
  seen.clear();
  return { put: uniq(c.put), remove };
}
