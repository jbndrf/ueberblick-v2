import { canonicalJson, tileCount, type Bounds, type MapLayer } from '@ueberblick/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { packHash, type PackDef } from './hash';
import { packTileIds } from './tile-range';

const layer = (url: string, maxzoom?: number): MapLayer => ({
  label: { de: 'L' },
  kind: 'base',
  source: { type: 'pmtiles', url },
  ...(maxzoom === undefined ? {} : { maxzoom }),
});

const pack = (over: Partial<PackDef> = {}): PackDef => ({
  label: { de: 'Innenstadt' },
  bounds: [7.08, 50.7, 7.14, 50.75],
  min_zoom: 12,
  max_zoom: 17,
  layers: ['a', 'b'],
  ...over,
});
const layers = { a: layer('https://t.test/a.pmtiles'), b: layer('https://t.test/b.pmtiles', 15) };

const shuffled = <T extends Record<string, unknown>>(o: T, order: readonly number[]): T => {
  const entries = Object.entries(o);
  const sorted = entries.map((e, i) => [order[i] ?? i, e] as const).sort((a, b) => a[0] - b[0]);
  return Object.fromEntries(sorted.map(([, e]) => e)) as T;
};

describe('pack hash', () => {
  it('is stable under key order (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(100), { minLength: 8, maxLength: 8 }), (order) => {
        const p = shuffled({ ...pack() }, order);
        const l = {
          a: shuffled({ ...layers.a, source: shuffled({ ...layers.a.source }, order) }, order),
          b: layers.b,
        };
        expect(packHash(p, l)).toBe(packHash(pack(), layers));
      }),
    );
  });

  it('is stable under layer order, label and roles: they change no tile', () => {
    const base = packHash(pack(), layers);
    expect(packHash(pack({ layers: ['b', 'a'] }), layers)).toBe(base);
    expect(packHash(pack({ label: { de: 'Anders' }, roles: ['kontrolle'] }), layers)).toBe(base);
  });

  it('changes with bounds, zooms, layers and layer source (property)', () => {
    const base = packHash(pack(), layers);
    fc.assert(
      fc.property(fc.double({ min: 0.001, max: 5, noNaN: true }), fc.integer({ min: 1, max: 4 }), (d, z) => {
        const seen = new Set([base]);
        const variants = [
          packHash(pack({ bounds: [7.08 + d, 50.7, 7.14 + d, 50.75] }), layers),
          packHash(pack({ min_zoom: 12 - z }), layers),
          packHash(pack({ max_zoom: 17 + z }), layers),
          packHash(pack({ layers: ['a'] }), layers),
          packHash(pack(), { ...layers, a: layer(`https://t.test/a${z}.pmtiles`) }),
          packHash(pack(), { ...layers, b: layer('https://t.test/b.pmtiles', 15 - z) }),
        ];
        for (const v of variants) seen.add(v);
        expect(seen.size).toBe(variants.length + 1);
      }),
    );
  });

  it('canonical JSON drops undefined and sorts nested keys', () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [2, { z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[2,{"y":2,"z":1}]},"b":1}',
    );
  });
});

describe('tile list', () => {
  it('has as many tiles as the estimate counts, ascending and without repeats (property)', () => {
    const lon = fc.double({ min: -179, max: 178, noNaN: true });
    const lat = fc.double({ min: -84, max: 83, noNaN: true });
    fc.assert(
      fc.property(
        lon,
        lat,
        fc.double({ min: 0.001, max: 3, noNaN: true }),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 3 }),
        (w, s, size, lo, extra) => {
          const bounds: Bounds = [w, s, Math.min(179.9, w + size), Math.min(84.9, s + size)];
          const ids = packTileIds(bounds, lo, lo + extra);
          expect(ids.length).toBe(tileCount(bounds, lo, lo + extra));
          expect(ids.every((id, i) => i === 0 || id > (ids[i - 1] as number))).toBe(true);
        },
      ),
    );
  });

  it("pins the pack hash to the value the server's former own canonicalJson produced (WP-781: stored hashes stay)", () => {
    expect(packHash(pack(), layers)).toBe('77ceb963ec1d7a799a75b3344713825ddca71888fd6a5fe333ff2ebff5be6103');
  });
});
