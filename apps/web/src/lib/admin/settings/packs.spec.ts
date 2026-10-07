import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TemplateFile } from '@ueberblick/core';
import {
  boundsAreaKm2,
  estimateOf,
  formatArea,
  formatBytes,
  formatTileCount,
  packLayerOptions,
  packProblem,
  packRoleOptions,
  packRows,
  polygonBounds,
  rectBounds,
} from './packs';

const FILE = {
  roles: { kontrolle: { label: { de: 'Kontrolle' } }, melder: { label: 'Melder' } },
  map: {
    layers: {
      osm: { label: { de: 'Straßenkarte' }, kind: 'base', source: { type: 'preset', preset: 'osm' } },
      luft: { label: { de: 'Luftbild' }, kind: 'overlay', source: { type: 'pmtiles', url: '/luft.pmtiles' } },
      flur: {
        label: { de: 'Flur' },
        kind: 'overlay',
        source: { type: 'wms', url: 'https://x/wms', layers: 'f' },
      },
    },
    packs: {
      innen: {
        label: { de: 'Innenstadt' },
        bounds: [7.08, 50.7, 7.14, 50.75],
        min_zoom: 12,
        max_zoom: 14,
        layers: ['osm'],
        roles: ['kontrolle'],
      },
    },
  },
} as unknown as TemplateFile;
const BOX = [7.08, 50.7, 7.14, 50.75] as const;
const GOOD = { name: 'Neu', minZoom: 12, maxZoom: 14, bounds: BOX, layers: ['osm'], roles: [] };

describe('the lists', () => {
  it('lists the draft packs with name, box, zoom, layers and roles (empty roles = everyone)', () => {
    expect(packRows(FILE, 'de')).toEqual([
      {
        key: 'innen',
        name: 'Innenstadt',
        bounds: BOX,
        minZoom: 12,
        maxZoom: 14,
        layers: ['osm'],
        roles: ['kontrolle'],
      },
    ]);
    expect(packRows({} as TemplateFile, 'de')).toEqual([]);
  });
  it('offers every layer; one no pack can hold (wms) is marked, a base is marked (v3 "Basis" badge)', () => {
    expect(packLayerOptions(FILE, 'de')).toEqual([
      { key: 'osm', label: 'Straßenkarte', base: true, packable: true },
      { key: 'luft', label: 'Luftbild', base: false, packable: true },
      { key: 'flur', label: 'Flur', base: false, packable: false },
    ]);
  });
  it('offers the roles of the file', () => {
    expect(packRoleOptions(FILE, 'de').map((r) => [r.key, r.label])).toEqual([
      ['kontrolle', 'Kontrolle'],
      ['melder', 'Melder'],
    ]);
  });
});

describe('packProblem: v3 order (region, name, layer), then zoom and size', () => {
  it('accepts a good pack', () => {
    expect(packProblem(GOOD, FILE)).toBeNull();
  });
  it('refuses in v3 order', () => {
    expect(packProblem({ ...GOOD, bounds: null, name: '', layers: [] }, FILE)).toBe('region');
    expect(packProblem({ ...GOOD, name: '  ', layers: [] }, FILE)).toBe('name');
    expect(packProblem({ ...GOOD, layers: [] }, FILE)).toBe('layers');
  });
  it('refuses a zoom outside 0 to 22, a reversed range and a fraction', () => {
    expect(packProblem({ ...GOOD, minZoom: 15, maxZoom: 12 }, FILE)).toBe('zoom');
    expect(packProblem({ ...GOOD, maxZoom: 23 }, FILE)).toBe('zoom');
    expect(packProblem({ ...GOOD, minZoom: 1.5 }, FILE)).toBe('zoom');
  });
  it('refuses a pack above the size limit, the one the checker refuses too', () => {
    expect(packProblem({ ...GOOD, bounds: [-10, 35, 30, 60], minZoom: 0, maxZoom: 14 }, FILE)).toBe(
      'too_large',
    );
  });
});

describe("the estimate is core's: the pmtiles layer with no known maximum goes to the pack maximum", () => {
  it('grows with the zoom range and with each layer', () => {
    const one = estimateOf(FILE, { bounds: BOX, minZoom: 12, maxZoom: 14, layers: ['osm'] });
    const two = estimateOf(FILE, { bounds: BOX, minZoom: 12, maxZoom: 14, layers: ['osm', 'luft'] });
    const deeper = estimateOf(FILE, { bounds: BOX, minZoom: 12, maxZoom: 15, layers: ['osm'] });
    expect(one.tiles).toBeGreaterThan(0);
    expect(two.tiles).toBeGreaterThan(one.tiles);
    expect(deeper.tiles).toBeGreaterThan(one.tiles);
    expect(estimateOf(FILE, { bounds: BOX, minZoom: 12, maxZoom: 14, layers: ['nope'] }).tiles).toBe(0);
  });
});

describe('boxes', () => {
  it('rectBounds orders any two corners as west, south, east, north (property)', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.double({ min: -180, max: 180, noNaN: true }),
          fc.double({ min: -85, max: 85, noNaN: true }),
        ),
        fc.tuple(
          fc.double({ min: -180, max: 180, noNaN: true }),
          fc.double({ min: -85, max: 85, noNaN: true }),
        ),
        (a, b) => {
          const [w, s, e, n] = rectBounds(a, b);
          expect(w).toBeLessThanOrEqual(e);
          expect(s).toBeLessThanOrEqual(n);
          expect(rectBounds(b, a)).toEqual([w, s, e, n]);
        },
      ),
    );
  });
  it('polygonBounds is the box around every vertex', () => {
    expect(
      polygonBounds([
        [7, 50],
        [8, 51],
        [7.5, 49],
      ]),
    ).toEqual([7, 49, 8, 51]);
    expect(polygonBounds([])).toBeNull();
  });
  it('the area of a box: about 1 km2 for 0.0090 by 0.0090 degrees at the equator', () => {
    expect(boundsAreaKm2([0, 0, 0.009, 0.009])).toBeGreaterThan(0.95);
    expect(boundsAreaKm2([0, 0, 0.009, 0.009])).toBeLessThan(1.05);
  });
  it('v3 formats', () => {
    expect(formatArea(0.005)).toBe('5000 m²');
    expect(formatArea(0.5)).toBe('50.0 ha');
    expect(formatArea(12.345)).toBe('12.35 km²');
    expect(formatArea(250)).toBe('250 km²');
    expect(formatTileCount(900)).toBe('~900');
    expect(formatTileCount(2500)).toBe('~2.5k');
    expect(formatTileCount(25000)).toBe('~25k');
    expect(formatBytes(undefined)).toBe('-');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
