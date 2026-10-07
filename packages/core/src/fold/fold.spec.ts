import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createFold } from './index';
import type { DerivedLookup, EdgeChanges, FoldSchema, FoldedFeature } from './contract';
import type { Edge, FeatureId, Json, Key, RecordedObservation, RunId } from '../model';
import { createGeo } from '../geo';
import type { Point, Polygon } from '../geo';
import { isServed } from '../registry/lifecycle';

const k = (s: string) => s as Key;
const fid = (s: string) => s as FeatureId;
function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a value');
  return v;
}
const geo = createGeo();
const fold = createFold(geo);

const schema: FoldSchema = {
  configVersion: 1,
  types: new Map([
    [
      k('tree'),
      {
        geometryProperties: [k('geometry')],
        references: [{ property: k('plot'), relation: k('on_plot'), to: k('plot') }],
        derived: [
          {
            relation: k('inside'),
            to: k('district'),
            predicate: 'within',
            selfProperty: k('geometry'),
            otherProperty: k('geometry'),
          },
        ],
      },
    ],
    [k('district'), { geometryProperties: [k('geometry')], references: [], derived: [] }],
    [k('plot'), { geometryProperties: [], references: [], derived: [] }],
  ]),
};

let seqCounter = 0;
const ob = (feature: string, property: string, result: Json, seq = ++seqCounter): RecordedObservation => ({
  featureId: fid(feature),
  property,
  result,
  seq,
  runId: 'r' as RunId,
});
const asJson = (g: Point | Polygon): Json => g as unknown as Json;
const pt = (x: number, y: number): Point => ({ type: 'Point', coordinates: [x, y] });
const sq = (x: number, y: number, s: number): Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + s, y],
      [x + s, y + s],
      [x, y + s],
      [x, y],
    ],
  ],
});

describe('fold.feature', () => {
  it('creates a feature from $type and keeps the highest seq per property', () => {
    const r = fold.feature(
      undefined,
      [ob('a', '$type', 'tree', 1), ob('a', 'h', 1, 2), ob('a', 'h', 5, 4), ob('a', 'h', 3, 3)],
      schema,
    );
    expect(r.feature?.type).toBe('tree');
    expect(r.feature?.properties).toEqual({ h: 5 });
    expect(r.feature?.updatedSeq).toBe(4);
    expect(r.feature?.lifecycle).toBe('active');
  });

  it('is order-sensitive by seq only, not by array order', () => {
    const a = [ob('a', '$type', 'tree', 1), ob('a', 'h', 1, 2), ob('a', 'h', 2, 3)];
    const shuffled = [a[2], a[0], a[1]].map(must);
    expect(fold.feature(undefined, shuffled, schema)).toEqual(fold.feature(undefined, a, schema));
  });

  it('has no feature until $type is seen', () => {
    expect(fold.feature(undefined, [ob('a', 'h', 1, 1)], schema).feature).toBeUndefined();
  });

  it('$lifecycle deleted removes it from service, a later active restores; reserved keys are not properties', () => {
    const d = must(
      fold.feature(undefined, [ob('a', '$type', 'tree', 1), ob('a', '$lifecycle', 'deleted', 2)], schema)
        .feature,
    );
    expect(d.lifecycle).toBe('deleted');
    expect(d.properties).toEqual({});
    const u = must(fold.feature(d, [ob('a', '$lifecycle', 'active', 3)], schema).feature);
    expect(u.lifecycle).toBe('active');
  });

  it('an unknown $lifecycle value changes nothing and is not stored as a property', () => {
    const a = must(
      fold.feature(undefined, [ob('a', '$type', 'tree', 1), ob('a', '$lifecycle', 'completed', 2)], schema)
        .feature,
    );
    const b = must(
      fold.feature(a, [ob('a', '$lifecycle', 'gone', 3), ob('a', '$lifecycle', 7, 4)], schema).feature,
    );
    expect(b.lifecycle).toBe('completed');
    expect(b.properties).toEqual({});
  });

  it('$lifecycle: the highest seq wins whatever the array order (property)', () => {
    const states = fc.constantFrom('active', 'completed', 'archived', 'deleted');
    fc.assert(
      fc.property(
        fc.array(states, { minLength: 1, maxLength: 8 }),
        fc.infiniteStream(fc.nat()),
        (list, noise) => {
          const log = [ob('a', '$type', 'tree', 1), ...list.map((v, i) => ob('a', '$lifecycle', v, i + 2))];
          const it = noise[Symbol.iterator]();
          const shuffled = log
            .map((o) => ({ o, key: it.next().value as number }))
            .sort((x, y) => x.key - y.key)
            .map((x) => x.o);
          expect(must(fold.feature(undefined, shuffled, schema).feature).lifecycle).toBe(
            list[list.length - 1],
          );
        },
      ),
    );
  });

  it('an unknown $lifecycle value is ignored', () => {
    const r = fold.feature(
      undefined,
      [ob('a', '$type', 'tree', 1), ob('a', '$lifecycle', 'gone', 2)],
      schema,
    );
    expect(must(r.feature).lifecycle).toBe('active');
  });

  it('replaying observations with seq <= updatedSeq changes nothing', () => {
    const log = [
      ob('a', '$type', 'tree', 1),
      ob('a', 'h', 1, 2),
      ob('a', 'geometry', asJson(pt(13.4, 52.5)), 3),
    ];
    const once = fold.feature(undefined, log, schema);
    const again = fold.feature(once.feature, log, schema);
    expect(again.feature).toEqual(once.feature);
    expect(again.geometryChanged).toEqual([]);
    expect(again.edges).toEqual({ put: [], remove: [] });
  });

  it('derives geometry values and reports the change', () => {
    const r = fold.feature(
      undefined,
      [ob('a', '$type', 'tree', 1), ob('a', 'geometry', asJson(pt(13.4, 52.5)), 2)],
      schema,
    );
    expect(r.geometryChanged).toEqual(['geometry']);
    expect(r.feature?.derived['geometry']?.bbox).toEqual([13.4, 52.5, 13.4, 52.5]);
    const same = fold.feature(r.feature, [ob('a', 'geometry', asJson(pt(13.4, 52.5)), 3)], schema);
    expect(same.geometryChanged).toEqual([]);
    const cleared = fold.feature(r.feature, [ob('a', 'geometry', null, 4)], schema);
    expect(cleared.geometryChanged).toEqual(['geometry']);
    expect(cleared.feature?.derived['geometry']).toBeUndefined();
  });

  it('turns reference values (single or list) into edges and swaps them on change', () => {
    const r1 = fold.feature(undefined, [ob('a', '$type', 'tree', 1), ob('a', 'plot', 'p1', 2)], schema);
    expect(r1.edges.put).toEqual<Edge[]>([
      { from: fid('a'), relation: k('on_plot'), to: fid('p1'), derived: false },
    ]);
    const r2 = fold.feature(r1.feature, [ob('a', 'plot', ['p2', 'p1'], 3)], schema);
    expect(r2.edges.remove).toEqual([]);
    expect(r2.edges.put.map((e) => e.to).sort()).toEqual(['p1', 'p2']);
    const r3 = fold.feature(r2.feature, [ob('a', 'plot', 'p2', 4)], schema);
    expect(r3.edges.remove.map((e) => e.to)).toEqual(['p1']);
  });

  it('property: chunks, one-by-one, shuffled input and duplicate replays all agree (H2)', () => {
    const prop = fc.constantFrom('h', 'plot', 'geometry', '$lifecycle', 'name');
    const val = fc.oneof(
      fc.integer({ min: 0, max: 9 }),
      fc.constantFrom<Json>(
        'p1',
        'p2',
        'deleted',
        'active',
        'archived',
        true,
        false,
        null,
        asJson(pt(13.4, 52.5)),
        asJson(pt(13.5, 52.6)),
      ),
    );
    /** Apply edge changes the way an adapter does: remove first, then put. */
    const applyEdges = (set: Set<string>, c: EdgeChanges): void => {
      for (const e of c.remove) set.delete(`${e.relation}>${e.to}`);
      for (const e of c.put) set.add(`${e.relation}>${e.to}`);
    };
    const run = (chunks: RecordedObservation[][]) => {
      let acc: FoldedFeature | undefined;
      const edges = new Set<string>();
      const geom = new Set<string>();
      for (const c of chunks) {
        const r = fold.feature(acc, c, schema);
        acc = r.feature;
        applyEdges(edges, r.edges);
        for (const g of r.geometryChanged) geom.add(g);
      }
      return { feature: acc, edges: [...edges].sort(), geom: [...geom].sort() };
    };
    fc.assert(
      fc.property(
        fc.array(fc.tuple(prop, val), { maxLength: 25 }),
        fc.array(fc.nat(30), { maxLength: 4 }),
        fc.infiniteStream(fc.nat(1000)),
        fc.array(fc.nat(40), { maxLength: 6 }),
        (rows, cuts, noise, dupAt) => {
          const log = [ob('a', '$type', 'tree', 1), ...rows.map(([p, v], i) => ob('a', p, v, i + 2))];
          const whole = run([log]);
          const bounds = [0, ...cuts.map((c) => Math.min(c, log.length)).sort((x, y) => x - y), log.length];
          const chunks = bounds.slice(1).map((end, i) => log.slice(bounds[i], end));
          expect(run(chunks)).toEqual(whole);
          expect(run(log.map((o) => [o]))).toEqual(whole);
          // Shuffled input, with identical replays of some observations (same seq, same content).
          const noisy = [...log, ...dupAt.map((i) => log[i % log.length] as RecordedObservation)];
          const it = noise[Symbol.iterator]();
          const shuffled = noisy
            .map((o) => ({ o, key: it.next().value as number }))
            .sort((x, y) => x.key - y.key)
            .map((x) => x.o);
          expect(run([shuffled])).toEqual(whole);
        },
      ),
    );
  });

  it('a lifecycle flip between served and unserved lists every geometry property that has a value, both ways', () => {
    const live = must(
      fold.feature(
        undefined,
        [ob('a', '$type', 'tree', 1), ob('a', 'geometry', asJson(pt(13.4, 52.5)), 2)],
        schema,
      ).feature,
    );
    const del = fold.feature(live, [ob('a', '$lifecycle', 'deleted', 3)], schema);
    expect(del.geometryChanged).toEqual(['geometry']);
    const back = fold.feature(del.feature, [ob('a', '$lifecycle', 'active', 4)], schema);
    expect(back.geometryChanged).toEqual(['geometry']);
    expect(fold.feature(back.feature, [ob('a', '$lifecycle', 'active', 5)], schema).geometryChanged).toEqual(
      [],
    );
    const done = fold.feature(live, [ob('a', '$lifecycle', 'completed', 3)], schema);
    expect(done.geometryChanged).toEqual([]); // completed is still served
    const bare = must(fold.feature(undefined, [ob('n', '$type', 'tree', 1)], schema).feature);
    expect(fold.feature(bare, [ob('n', '$lifecycle', 'deleted', 2)], schema).geometryChanged).toEqual([]);
  });
});

/** In-memory adapter: what the server's R*Tree + edge table would answer. */
function world(features: FoldedFeature[], edges: Edge[]): DerivedLookup {
  return {
    near: (type, bbox) =>
      features.filter((f) => {
        if (f.type !== type || !isServed(f.lifecycle)) return false;
        return Object.values(f.derived).some(
          (d) => d.bbox[0] <= bbox[2] && d.bbox[2] >= bbox[0] && d.bbox[1] <= bbox[3] && d.bbox[3] >= bbox[1],
        );
      }),
    typesDerivingTo: (type) =>
      [...schema.types].filter(([, t]) => t.derived.some((d) => d.to === type)).map(([n]) => n),
    edgesFrom: (id, relation) => edges.filter((e) => e.from === id && e.relation === relation),
    edgesTo: (id, relation) => edges.filter((e) => e.to === id && e.relation === relation),
    condition: () => true,
  };
}
const make = (id: string, type: string, geometry: Point | Polygon, seq: number): FoldedFeature =>
  must(
    fold.feature(
      undefined,
      [ob(id, '$type', type, seq), ob(id, 'geometry', asJson(geometry), seq + 1)],
      schema,
    ).feature,
  );

describe('fold.recomputeDerived', () => {
  const district = make('d1', 'district', sq(13.4, 52.5, 0.1), 1);
  const inside = make('t1', 'tree', pt(13.45, 52.55), 3);
  const outside = make('t2', 'tree', pt(14, 53), 5);
  const edge: Edge = { from: fid('t1'), relation: k('inside'), to: fid('d1'), derived: true };

  it('forward: a tree gets an edge to the district that contains it', () => {
    const ch = fold.recomputeDerived(inside, world([district, inside, outside], []), schema);
    expect(ch.put).toEqual<Edge[]>([edge]);
    expect(fold.recomputeDerived(outside, world([district, inside, outside], []), schema)).toEqual({
      put: [],
      remove: [],
    });
  });

  it('forward: moving the tree out removes the edge', () => {
    const moved = must(fold.feature(inside, [ob('t1', 'geometry', asJson(pt(14, 53)), 20)], schema).feature);
    const ch = fold.recomputeDerived(moved, world([district, moved], [edge]), schema);
    expect(ch).toEqual({ put: [], remove: [edge] });
  });

  it('reverse: growing the district picks up trees; shrinking drops them', () => {
    const big = must(
      fold.feature(district, [ob('d1', 'geometry', asJson(sq(13, 52, 2)), 30)], schema).feature,
    );
    const grow = fold.recomputeDerived(big, world([big, inside, outside], [edge]), schema);
    expect(grow.put.map((e) => e.from)).toEqual(['t2']);
    expect(grow.remove).toEqual([]);
    const small = must(
      fold.feature(district, [ob('d1', 'geometry', asJson(sq(20, 20, 0.1)), 31)], schema).feature,
    );
    expect(fold.recomputeDerived(small, world([small, inside], [edge]), schema).remove).toEqual([edge]);
  });

  it('a deleted feature loses all its derived edges; reference edges are untouched', () => {
    const ref: Edge = { from: fid('t1'), relation: k('inside'), to: fid('x'), derived: false };
    const gone = must(fold.feature(inside, [ob('t1', '$lifecycle', 'deleted', 40)], schema).feature);
    expect(fold.recomputeDerived(gone, world([district, gone], [edge, ref]), schema).remove).toEqual([edge]);
  });

  it('deleting via fold flags the geometry and recomputeDerived then drops the edges; restoring brings them back', () => {
    const del = fold.feature(inside, [ob('t1', '$lifecycle', 'deleted', 50)], schema);
    expect(del.geometryChanged).not.toEqual([]);
    const gone = must(del.feature);
    expect(fold.recomputeDerived(gone, world([district, gone], [edge]), schema).remove).toEqual([edge]);
    const back = fold.feature(gone, [ob('t1', '$lifecycle', 'active', 51)], schema);
    expect(back.geometryChanged).not.toEqual([]);
    expect(
      fold.recomputeDerived(must(back.feature), world([district, must(back.feature)], []), schema).put,
    ).toEqual([edge]);
  });
});

describe('fold.feature: $lifecycle (WP-305)', () => {
  it('$type starts a feature active; the highest seq of $lifecycle wins', () => {
    const r = must(
      fold.feature(
        undefined,
        [
          ob('a', '$type', 'tree', 1),
          ob('a', '$lifecycle', 'archived', 3),
          ob('a', '$lifecycle', 'completed', 2),
        ],
        schema,
      ).feature,
    );
    expect(r.lifecycle).toBe('archived');
    expect(must(fold.feature(undefined, [ob('b', '$type', 'tree', 1)], schema).feature).lifecycle).toBe(
      'active',
    );
  });

  it('property: the result does not depend on the order observations arrive in', () => {
    const states = fc.constantFrom('active', 'completed', 'archived', 'deleted');
    fc.assert(
      fc.property(fc.array(states, { minLength: 1, maxLength: 8 }), fc.integer(), (list, salt) => {
        const obs = [ob('a', '$type', 'tree', 1), ...list.map((s, i) => ob('a', '$lifecycle', s, i + 2))];
        const shuffled = [...obs].sort((x, y) => ((x.seq * 7919 + salt) % 13) - ((y.seq * 7919 + salt) % 13));
        const a = must(fold.feature(undefined, obs, schema).feature);
        const b = must(fold.feature(undefined, shuffled, schema).feature);
        expect(b.lifecycle).toBe(a.lifecycle);
        expect(a.lifecycle).toBe(list[list.length - 1]);
      }),
    );
  });

  it('an unknown $lifecycle value is ignored', () => {
    const r = must(
      fold.feature(undefined, [ob('a', '$type', 'tree', 1), ob('a', '$lifecycle', 'gone', 2)], schema)
        .feature,
    );
    expect(r.lifecycle).toBe('active');
  });
});
