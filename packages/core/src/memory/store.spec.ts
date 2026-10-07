// WP-050: MemoryStore.near (Facts port, WP-041.1) uses the shared bbox helpers.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CompiledConfig } from '../schema/compile/contract';
import { createGeo } from '../geo';
import { bboxIntersects, bboxOf, unionBbox } from '../geo/bbox';
import type { Bbox } from '../geo/contract';
import type { Key } from '../model';
import { SIM_CONFIG_VERSION, createClock } from '../testing/ids';
import { MemoryStore } from './store';
import { baumWorkload } from '../testing/workloads';
import { isServed } from '../registry/lifecycle';

describe('MemoryStore.near', () => {
  const w = baumWorkload();
  const store = new MemoryStore(
    w.config,
    createClock('2026-05-01T08:00:00Z'),
    createGeo(),
    SIM_CONFIG_VERSION,
  );
  w.seed(store);
  const ids = (type: string, box: Bbox): string[] =>
    [...store.near(type as Key, box)].map((f) => f.id).sort();

  it('returns features of the type whose bbox meets the box, and no others', () => {
    // t_in lies at 7.102, 50.732; t_out at 7.12, 50.75
    expect(ids('baum', [7.101, 50.731, 7.103, 50.733])).toHaveLength(1);
    expect(ids('baum', [8, 51, 9, 52])).toEqual([]);
    expect(ids('flaeche', [7.101, 50.731, 7.103, 50.733])).toHaveLength(1); // the park polygon
  });

  it('counts edge contact and skips features without geometry', () => {
    expect(ids('baum', [7.102, 50.732, 7.5, 50.9]).length).toBeGreaterThan(0);
    expect(ids('baumart', [-180, -90, 180, 90])).toEqual([]);
  });

  it('gives the same result as computing each geometry bbox from the property value', () => {
    const boxes: Bbox[] = [
      [7.101, 50.731, 7.103, 50.733],
      [7.0, 50.0, 8.0, 51.0],
      [7.11, 50.74, 7.13, 50.76],
      [8, 51, 9, 52],
    ];
    for (const type of ['baum', 'flaeche']) {
      const props = w.config.foldTypes.get(type as Key)?.geometryProperties ?? [];
      for (const box of boxes) {
        const expected = [...store.features.values()]
          .filter((f) => {
            if (f.type !== type || !isServed(f.lifecycle)) return false;
            const u = unionBbox(
              props.map((p) => (f.properties[p] ? bboxOf(f.properties[p] as never) : undefined)),
            );
            return u !== undefined && bboxIntersects(u, box);
          })
          .map((f) => f.id)
          .sort();
        expect(ids(type, box)).toEqual(expected);
      }
    }
  });
});

describe('MemoryStore.near with two geometry properties', () => {
  const cfg = {
    foldTypes: new Map([['two', { geometryProperties: ['a', 'b'] }]]),
  } as unknown as CompiledConfig;
  const make = (boxes: { a?: Bbox | undefined; b?: Bbox | undefined }[]): MemoryStore => {
    const s = new MemoryStore(cfg, createClock('2026-05-01T08:00:00Z'), createGeo(), SIM_CONFIG_VERSION);
    boxes.forEach((d, i) => {
      const derived: { [k: string]: { bbox: Bbox } } = {};
      if (d.a) derived.a = { bbox: d.a };
      if (d.b) derived.b = { bbox: d.b };
      s.features.set(
        `f${i}` as never,
        { id: `f${i}`, type: 'two', lifecycle: 'active', properties: {}, derived } as never,
      );
    });
    return s;
  };
  const near = (s: MemoryStore, box: Bbox): string[] => [...s.near('two' as Key, box)].map((f) => f.id);

  it('matches when only the second property meets the box', () => {
    expect(near(make([{ a: [0, 0, 1, 1], b: [10, 10, 11, 11] }]), [10.5, 10.5, 12, 12])).toHaveLength(1);
  });
  it('matches via the union span although no single property meets the box', () => {
    expect(near(make([{ a: [0, 0, 1, 1], b: [10, 10, 11, 11] }]), [5, 5, 6, 6])).toHaveLength(1);
  });
  it('skips a feature without geometry', () => {
    expect(near(make([{}]), [-180, -90, 180, 90])).toEqual([]);
  });

  const bboxArb = fc
    .tuple(fc.integer({ min: -50, max: 50 }), fc.integer({ min: -50, max: 50 }), fc.nat(30), fc.nat(30))
    .map(([x, y, w, h]): Bbox => [x, y, x + w, y + h]);
  it('property: equals the naive unionBbox reference', () => {
    const entry = fc.record({
      a: fc.option(bboxArb, { nil: undefined }),
      b: fc.option(bboxArb, { nil: undefined }),
    });
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 12 }), bboxArb, (boxes, q) => {
        const expected = boxes
          .map((d, i) => ({ u: unionBbox([d.a, d.b]), id: `f${i}` }))
          .filter((x) => x.u !== undefined && bboxIntersects(x.u, q))
          .map((x) => x.id);
        expect(near(make(boxes), q).sort()).toEqual(expected.sort());
      }),
    );
  });
});
