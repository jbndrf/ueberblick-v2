/**
 * Fixtures of the Facts conformance suite (WP-146): the test schema, geometry helpers, random logs and a brute-force
 * model of what `Facts` must answer. Pure: no I/O, no clock, no database (R2). Adapters (SQLite, MemoryStore) fold
 * and store through their own write path; this file only says what they must read back.
 */
import fc from 'fast-check';
import { createFold, edgeKey } from '../fold';
import type { DerivedLookup, FoldedFeature, FoldSchema } from '../fold/contract';
import { createGeo } from '../geo';
import { isLive } from '../registry/lifecycle';
import { bboxIntersects } from '../geo/bbox';
import type { Edge, FeatureId, Json, Key, RecordedObservation, RunId } from '../model';

export const k = (s: string): Key => s as Key;
export const fid = (s: string): FeatureId => s as FeatureId;
const RUN = 'r1' as RunId;

/** tree (point, reference `plot`, derived `area_of` within an area), plot, area (polygons). */
export const SCHEMA: FoldSchema = {
  configVersion: 1,
  types: new Map([
    [
      k('tree'),
      {
        geometryProperties: [k('geometry')],
        primaryGeometry: k('geometry'),
        references: [{ property: k('plot'), relation: k('plot'), to: k('plot') }],
        derived: [
          {
            relation: k('area_of'),
            to: k('area'),
            predicate: 'within',
            selfProperty: k('geometry'),
            otherProperty: k('geometry'),
          },
        ],
      },
    ],
    [
      k('plot'),
      { geometryProperties: [k('geometry')], primaryGeometry: k('geometry'), references: [], derived: [] },
    ],
    // Two geometry properties, the second one primary (B-009); `unanchored` declares none.
    [
      k('multi'),
      {
        geometryProperties: [k('aaa_extra'), k('footprint')],
        primaryGeometry: k('footprint'),
        references: [],
        derived: [],
      },
    ],
    [k('unanchored'), { geometryProperties: [k('geometry')], references: [], derived: [] }],
    [
      k('area'),
      { geometryProperties: [k('geometry')], primaryGeometry: k('geometry'), references: [], derived: [] },
    ],
  ]),
};

/** The relation files of the test schema: `plot.trees` reads `tree.plot` backwards, `area.trees` reads `tree.area_of`. */
export const INVERSE_OF: ReadonlyMap<string, string> = new Map([
  ['plot.trees', 'tree.plot'],
  ['area.trees', 'tree.area_of'],
]);

export const point = (x: number, y: number, z?: number): Json => ({
  type: 'Point',
  coordinates: z === undefined ? [x, y] : [x, y, z],
});
export const square = (x: number, y: number, d: number): Json => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + d, y],
      [x + d, y + d],
      [x, y + d],
      [x, y],
    ],
  ],
});

export const ob = (feature: string, property: string, result: Json, seq: number): RecordedObservation => ({
  featureId: fid(feature),
  property,
  result,
  seq,
  runId: RUN,
});

const geo = createGeo();
const fold = createFold(geo);

/** What the store must answer, written the obvious way (with `Map`s and full scans). */
export class Model {
  readonly features = new Map<FeatureId, FoldedFeature>();
  /** Every stored edge, live far end or not: what the fold keeps. */
  readonly edges = new Map<string, Edge>();
  readonly log: RecordedObservation[] = [];

  history(id: FeatureId, property: string, limit: number): RecordedObservation[] {
    return this.log
      .filter((o) => o.featureId === id && o.property === property)
      .sort((a, b) => b.seq - a.seq)
      .slice(0, Math.max(0, limit));
  }

  /** A feature that exists and is not deleted: the far end rule of docs/04 (relation sets). */
  live = (id: FeatureId): boolean => isLive(this.features.get(id));

  edgesFrom(id: FeatureId, relation?: Key): Edge[] {
    return [...this.edges.values()].filter(
      (e) => e.from === id && (relation === undefined || e.relation === relation) && this.live(e.to),
    );
  }
  edgesTo(id: FeatureId, relation?: Key): Edge[] {
    return [...this.edges.values()].filter(
      (e) => e.to === id && (relation === undefined || e.relation === relation) && this.live(e.from),
    );
  }

  /** Folds `obs` (ascending seq) like the write path of a side does: features, reference edges, derived edges. */
  apply(obs: readonly RecordedObservation[]): void {
    this.log.push(...obs);
    const byFeature = new Map<FeatureId, RecordedObservation[]>();
    for (const o of obs) byFeature.set(o.featureId, [...(byFeature.get(o.featureId) ?? []), o]);
    for (const [id, list] of byFeature) {
      const r = fold.feature(this.features.get(id), list, SCHEMA);
      if (!r.feature) continue;
      this.features.set(id, r.feature);
      this.change(r.edges);
      if (r.geometryChanged.length > 0) this.change(fold.recomputeDerived(r.feature, this.lookup(), SCHEMA));
    }
  }

  private change(c: { readonly put: readonly Edge[]; readonly remove: readonly Edge[] }): void {
    for (const e of c.remove) this.edges.delete(edgeKey(e));
    for (const e of c.put) this.edges.set(edgeKey(e), e);
  }

  private lookup(): DerivedLookup {
    return {
      near: (type, bbox) =>
        [...this.features.values()].filter(
          (f) => f.type === type && Object.values(f.derived).some((d) => bboxIntersects(d.bbox, bbox)),
        ),
      typesDerivingTo: (type) =>
        [...SCHEMA.types].filter(([, t]) => t.derived.some((d) => d.to === type)).map(([n]) => n),
      // The fold needs the stored edges, dead ends included, to remove the ones that no longer hold.
      edgesFrom: (id, relation) =>
        [...this.edges.values()].filter((e) => e.from === id && e.relation === relation),
      edgesTo: (id, relation) =>
        [...this.edges.values()].filter((e) => e.to === id && e.relation === relation),
      condition: () => {
        throw new Error('the test schema has no derive condition');
      },
    };
  }
}

export const IDS = ['t0', 't1', 't2', 't3', 'p0', 'p1', 'a0', 'a1'];
const TYPE_OF = (i: number): string => (i < 4 ? 'tree' : i < 6 ? 'plot' : 'area');

export type Op =
  | {
      readonly f: number;
      readonly kind: 'geometry';
      readonly x: number;
      readonly y: number;
      readonly d: number;
    }
  | { readonly f: number; readonly kind: 'plot'; readonly to: number | null }
  | { readonly f: number; readonly kind: 'name'; readonly v: number }
  | { readonly f: number; readonly kind: 'deleted'; readonly v: boolean };

export const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    f: fc.nat(7),
    kind: fc.constant('geometry' as const),
    x: fc.nat(4),
    y: fc.nat(4),
    d: fc.integer({ min: 1, max: 3 }),
  }),
  fc.record({
    f: fc.nat(3),
    kind: fc.constant('plot' as const),
    to: fc.option(fc.integer({ min: 4, max: 5 }), { nil: null }),
  }),
  fc.record({ f: fc.nat(7), kind: fc.constant('name' as const), v: fc.nat(3) }),
  fc.record({ f: fc.nat(7), kind: fc.constant('deleted' as const), v: fc.boolean() }),
);

/** Creation of all eight features first, then the random operations, with ascending seq. */
export function toLog(ops: readonly Op[]): RecordedObservation[] {
  const out: RecordedObservation[] = [];
  const add = (f: number, property: string, result: RecordedObservation['result']): void => {
    out.push(ob(IDS[f] as string, property, result, out.length + 1));
  };
  IDS.forEach((id, i) => {
    add(i, '$type', TYPE_OF(i));
    add(i, 'code', id);
  });
  for (const o of ops) {
    if (o.kind === 'geometry') add(o.f, 'geometry', o.f < 4 ? point(o.x, o.y) : square(o.x, o.y, o.d));
    else if (o.kind === 'plot') add(o.f, 'plot', o.to === null ? null : (IDS[o.to] as string));
    else if (o.kind === 'name') add(o.f, 'name', `n${o.v}`);
    else add(o.f, '$lifecycle', o.v ? 'deleted' : 'active');
  }
  return out;
}
