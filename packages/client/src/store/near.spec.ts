/** Facts.near on the in-memory mirror agrees with a brute-force bbox filter, across puts, updates and tombstones. */
import type { Bbox } from '@ueberblick/core/geo';
import type { FeatureId, FeatureState, Key } from '@ueberblick/core/model';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Prediction } from './contract';
import { MemoryIndex } from './memory';

const meets = (a: Bbox, b: Bbox) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const id = (n: number) => `f${n}` as FeatureId;
const tk = (t: string) => t as Key;
const feat = (n: number, type: string, geometry: object | undefined): FeatureState => ({
  id: id(n),
  type: tk(type),
  properties: geometry ? { geometry: geometry as never } : {},
  lifecycle: 'active',
  updatedSeq: 1,
});
const pt = (x: number, y: number) => ({ type: 'Point', coordinates: [x, y, 5] });
const box = (b: Bbox) => ({
  type: 'Polygon',
  coordinates: [
    [
      [b[0], b[1]],
      [b[2], b[1]],
      [b[2], b[3]],
      [b[0], b[3]],
      [b[0], b[1]],
    ],
  ],
});
const ids = (it: Iterable<FeatureState>) => [...it].map((f) => f.id as string).sort();

describe('Facts.near (client mirror)', () => {
  it('filters by type, skips features without geometry, ignores Z', () => {
    const m = new MemoryIndex();
    m.putFeature(feat(1, 'tree', pt(1, 1)));
    m.putFeature(feat(2, 'tree', undefined));
    m.putFeature(feat(3, 'plot', pt(1, 1)));
    expect(ids(m.near(tk('tree'), [0, 0, 2, 2]))).toEqual(['f1']);
    expect(ids(m.near(tk('plot'), [0, 0, 2, 2]))).toEqual(['f3']);
  });

  it('counts edge contact as intersecting', () => {
    const m = new MemoryIndex();
    m.putFeature(feat(1, 'tree', pt(1, 1)));
    expect(ids(m.near(tk('tree'), [1, 1, 3, 3]))).toEqual(['f1']);
    expect(ids(m.near(tk('tree'), [-2, -2, 1, 1]))).toEqual(['f1']);
    expect(ids(m.near(tk('tree'), [1.001, 1, 3, 3]))).toEqual([]);
  });

  it('finds wide polygons and honours updates and deletes', () => {
    const m = new MemoryIndex();
    m.putFeature(feat(1, 'area', box([0, 0, 5, 5])));
    expect(ids(m.near(tk('area'), [2, 2, 3, 3]))).toEqual(['f1']);
    m.putFeature(feat(1, 'area', box([10, 10, 11, 11])));
    expect(ids(m.near(tk('area'), [2, 2, 3, 3]))).toEqual([]);
    expect(ids(m.near(tk('area'), [10.5, 10.5, 12, 12]))).toEqual(['f1']);
    m.deleteFeature(id(1));
    expect(ids(m.near(tk('area'), [0, 0, 20, 20]))).toEqual([]);
  });

  it('a put with lifecycle deleted removes the feature from near', () => {
    const m = new MemoryIndex();
    m.putFeature(feat(1, 'tree', pt(1, 1)));
    expect(ids(m.near(tk('tree'), [0, 0, 2, 2]))).toEqual(['f1']);
    m.putFeature({ ...feat(1, 'tree', pt(1, 1)), lifecycle: 'deleted' });
    expect(ids(m.near(tk('tree'), [0, 0, 2, 2]))).toEqual([]);
    m.putFeature({ ...feat(2, 'tree', pt(1, 1)), lifecycle: 'deleted' });
    expect(ids(m.near(tk('tree'), [0, 0, 2, 2]))).toEqual([]);
    m.putFeature(feat(1, 'tree', pt(1, 1)));
    expect(ids(m.near(tk('tree'), [0, 0, 2, 2]))).toEqual(['f1']);
  });

  it('a prediction supersedes the committed feature', () => {
    const m = new MemoryIndex();
    m.putFeature(feat(1, 'tree', pt(1, 1)));
    const p = {
      runId: 'r',
      features: [feat(1, 'tree', pt(9, 9)), feat(2, 'tree', pt(1, 1))],
      edges: [],
      observations: [],
    };
    m.setPrediction(p as unknown as Prediction);
    expect(ids(m.near(tk('tree'), [0, 0, 2, 2]))).toEqual(['f2']);
    expect(ids(m.near(tk('tree'), [8, 8, 10, 10]))).toEqual(['f1']);
  });

  it('agrees with brute force over random puts, updates and deletes', () => {
    const num = (min: number, max: number) => fc.double({ min, max, noNaN: true });
    const shape = fc.oneof(
      fc.tuple(num(-1, 1), num(-1, 1)).map(([x, y]) => ({ g: pt(x, y), b: [x, y, x, y] as Bbox })),
      fc
        .tuple(num(-1, 1), num(-1, 1), num(0, 1.2))
        .map(([x, y, d]) => ({ g: box([x, y, x + d, y + d]), b: [x, y, x + d, y + d] as Bbox })),
    );
    const op = fc.oneof(
      fc.record({
        kind: fc.constant('put' as const),
        n: fc.nat(15),
        type: fc.constantFrom('a', 'b'),
        s: shape,
      }),
      fc.record({ kind: fc.constant('del' as const), n: fc.nat(15) }),
    );
    const probe = fc
      .tuple(num(-1.5, 1.5), num(-1.5, 1.5), num(0, 1))
      .map(([x, y, d]): Bbox => [x, y, x + d, y + d]);
    fc.assert(
      fc.property(
        fc.array(op, { maxLength: 40 }),
        fc.array(probe, { minLength: 1, maxLength: 5 }),
        (ops, probes) => {
          const m = new MemoryIndex();
          const model = new Map<number, { type: string; b: Bbox }>();
          for (const o of ops) {
            if (o.kind === 'put') {
              m.putFeature(feat(o.n, o.type, o.s.g));
              model.set(o.n, { type: o.type, b: o.s.b });
            } else {
              m.deleteFeature(id(o.n));
              model.delete(o.n);
            }
          }
          for (const p of probes)
            for (const type of ['a', 'b']) {
              const want = [...model]
                .filter(([, v]) => v.type === type && meets(v.b, p))
                .map(([n]) => `f${n}`)
                .sort();
              expect(ids(m.near(tk(type), p))).toEqual(want);
            }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('Facts.ofType (client mirror)', () => {
  it('lists live features of the type without geometry too, and lays predictions over them', () => {
    const m = new MemoryIndex();
    m.putFeature(feat(1, 'order', undefined));
    m.putFeature(feat(2, 'order', pt(1, 1)));
    m.putFeature(feat(3, 'plot', undefined));
    m.putFeature({ ...feat(4, 'order', undefined), lifecycle: 'deleted' });
    expect(ids(m.ofType(tk('order')))).toEqual(['f1', 'f2']);
    const p = {
      runId: 'r',
      features: [{ ...feat(1, 'order', undefined), lifecycle: 'deleted' }, feat(5, 'order', undefined)],
      edges: [],
    };
    m.setPrediction(p as unknown as Prediction);
    expect(ids(m.ofType(tk('order')))).toEqual(['f2', 'f5']);
    m.removePrediction('r');
    expect(ids(m.ofType(tk('order')))).toEqual(['f1', 'f2']);
  });
});
