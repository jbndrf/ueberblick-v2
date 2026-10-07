import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MAP_RESERVED_LAYERS, MAP_SOURCE_TYPES, defaultSelection, layersForRoles } from '../registry';
import { MapSchema, type MapConfig } from './map';

import { TemplateFileSchema } from './file';
import { KeySchema } from './primitives';

const label = { de: 'X' };
const layer = (source: unknown, extra: Record<string, unknown> = {}) => ({
  label,
  kind: 'base',
  source,
  ...extra,
});
const sources: Record<string, unknown> = {
  xyz: { type: 'xyz', url: 'https://t.example/{z}/{x}/{y}.png' },
  wms: { type: 'wms', url: 'https://wms.example/service', layers: 'dop' },
  geojson: { type: 'geojson', url: 'https://x.example/a.geojson' },
  pmtiles: { type: 'pmtiles', url: 'https://x.example/a.pmtiles' },
  preset: { type: 'preset', preset: 'osm' },
};

describe('map zoom bounds (A-036)', () => {
  const m = (extra: Record<string, unknown>) =>
    MapSchema.safeParse({ start: { center: [10, 51], zoom: 10 }, layers: {}, ...extra });
  const issue = (r: ReturnType<typeof m>) => (r.success ? undefined : r.error.issues[0]);
  it('accepts min_zoom <= start.zoom <= max_zoom, and each alone', () => {
    expect(m({ min_zoom: 1, max_zoom: 19 }).success).toBe(true);
    expect(m({ min_zoom: 10, max_zoom: 10 }).success).toBe(true);
    expect(m({ min_zoom: 3 }).success).toBe(true);
    expect(m({ max_zoom: 24 }).success).toBe(true);
  });
  it('refuses min above max, a start outside the bounds, non-integers and values outside 0-24', () => {
    expect(issue(m({ min_zoom: 12, max_zoom: 5 }))?.path).toEqual(['min_zoom']);
    expect(issue(m({ min_zoom: 11 }))?.path).toEqual(['start', 'zoom']);
    expect(issue(m({ max_zoom: 9 }))?.path).toEqual(['start', 'zoom']);
    expect(m({ min_zoom: 1.5 }).success).toBe(false);
    expect(m({ min_zoom: -1 }).success).toBe(false);
    expect(m({ max_zoom: 25 }).success).toBe(false);
  });
  it('property: valid exactly when min <= zoom <= max', () => {
    const z = fc.integer({ min: 0, max: 24 });
    fc.assert(
      fc.property(z, z, z, (lo, zoom, hi) => {
        const r = m({ min_zoom: lo, max_zoom: hi, start: { center: [0, 0], zoom } });
        expect(r.success).toBe(lo <= zoom && zoom <= hi);
      }),
    );
  });
});

describe('MapSchema', () => {
  it('accepts each registered source type', () => {
    expect(Object.keys(sources).sort()).toEqual([...MAP_SOURCE_TYPES.keys].sort());
    for (const [type, source] of Object.entries(sources)) {
      const r = MapSchema.safeParse({ layers: { l: layer(source) } });
      expect(r.success, type).toBe(true);
    }
  });

  it('accepts a full layer and the start view', () => {
    const r = MapSchema.safeParse({
      start: { center: [10.4, 51.1], zoom: 10 },
      layers: {
        osm: layer(sources.preset, {
          attribution: 'a',
          opacity: 0.5,
          minzoom: 2,
          maxzoom: 18,
          roles: ['a'],
          on_at_start: true,
        }),
        wms: layer(sources.wms, { kind: 'overlay', advanced: { paint: { 'raster-saturation': -1 } } }),
      },
      order: ['wms', 'osm'],
    });
    expect(r.success).toBe(true);
  });

  it('refuses unknown source types, bad URLs and unknown presets', () => {
    const bad = [
      { type: 'shapefile', url: 'https://x.example/a' },
      { type: 'xyz', url: 'not a url' },
      { type: 'xyz', url: 'ftp://x.example/{z}/{x}/{y}.png' },
      { type: 'xyz', url: 'https://x.example/tiles.png' },
      { type: 'geojson', url: 'javascript:alert(1)' },
      { type: 'wms', url: 'https://wms.example/service' },
      { type: 'preset', preset: 'esri' },
    ];
    for (const source of bad) {
      expect(MapSchema.safeParse({ layers: { l: layer(source) } }).success, JSON.stringify(source)).toBe(
        false,
      );
    }
  });

  it('points an error at the source field', () => {
    const r = MapSchema.safeParse({ layers: { l: layer({ type: 'xyz', url: 'nope' }) } });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['layers', 'l', 'source', 'url']);
  });

  it('cannot declare a reserved layer key: every reserved key fails the key pattern (WP-712)', () => {
    for (const { key } of MAP_RESERVED_LAYERS.entries) {
      expect(KeySchema.safeParse(key).success, key).toBe(false);
      const r = MapSchema.safeParse({ layers: { [key]: layer(sources.preset) } });
      expect(r.success, key).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.path).toEqual(['layers', key]);
    }
    expect(MapSchema.safeParse({ layers: { osm: layer(sources.preset) } }).success).toBe(true);
  });

  it('refuses bad numbers, kinds, unknown keys and an order naming a missing layer', () => {
    const l = (extra: Record<string, unknown>) =>
      MapSchema.safeParse({ layers: { l: layer(sources.xyz, extra) } }).success;
    expect(l({ opacity: 2 })).toBe(false);
    expect(l({ minzoom: -1 })).toBe(false);
    expect(l({ kind: 'sideways' })).toBe(false);
    expect(l({ colour: 'red' })).toBe(false);
    expect(l({ advanced: { paint: 5 } })).toBe(false);
    expect(MapSchema.safeParse({ layers: { l: layer(sources.xyz) }, order: ['nope'] }).success).toBe(false);
    expect(MapSchema.safeParse({ start: { center: [200, 0] }, layers: {} }).success).toBe(false);
  });

  it('is an optional section of a template file', () => {
    const file = {
      schema: 'ueberblick/1',
      template: { key: 'm', version: '1.0.0' },
      map: { layers: { osm: layer(sources.preset) } },
    };
    expect(TemplateFileSchema.safeParse(file).success).toBe(true);
    expect(
      TemplateFileSchema.safeParse({ ...file, map: { layers: { osm: layer({ type: 'x' }) } } }).success,
    ).toBe(false);
  });
});

const cfg = (layers: Record<string, unknown>): MapConfig => MapSchema.parse({ layers });

describe('layersForRoles', () => {
  const map = cfg({
    open: layer(sources.xyz),
    intern: layer(sources.wms, { kind: 'overlay', roles: ['verwaltung'] }),
    both: layer(sources.geojson, { kind: 'overlay', roles: ['kontrolle', 'verwaltung'] }),
    nobody: layer(sources.geojson, { kind: 'overlay', roles: [] }),
  });
  it('keeps layers without roles and those matching any of the roles', () => {
    expect(Object.keys(layersForRoles(map, ['kontrolle']).layers)).toEqual(['open', 'both']);
    expect(Object.keys(layersForRoles(map, ['verwaltung']).layers)).toEqual(['open', 'intern', 'both']);
    expect(Object.keys(layersForRoles(map, []).layers)).toEqual(['open']);
  });
  it('keeps start, drops removed keys from order', () => {
    const m = MapSchema.parse({
      start: { center: [1, 2], zoom: 3 },
      layers: { a: layer(sources.xyz), b: layer(sources.xyz, { roles: ['x'] }) },
      order: ['b', 'a'],
    });
    const r = layersForRoles(m, []);
    expect(r.start).toEqual(m.start);
    expect(r.order).toEqual(['a']);
  });
  it('property: result is a subset and never contains a foreign-role layer', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom<string>('a', 'b', 'c')), (roles) => {
        const out = layersForRoles(map, roles).layers;
        for (const [k, l] of Object.entries(out)) {
          expect(k in map.layers).toBe(true);
          expect(l.roles === undefined || l.roles.some((r) => roles.includes(r))).toBe(true);
        }
      }),
    );
  });
});

describe('defaultSelection', () => {
  it('picks the first base with on_at_start, else the first base; overlays that are on at start', () => {
    const m = cfg({
      a: layer(sources.xyz),
      b: layer(sources.xyz, { on_at_start: true }),
      o1: layer(sources.wms, { kind: 'overlay', on_at_start: true }),
      o2: layer(sources.wms, { kind: 'overlay' }),
    });
    expect(defaultSelection(m)).toEqual({ base: 'b', overlays: ['o1'] });
    const n = cfg({ a: layer(sources.xyz), o: layer(sources.wms, { kind: 'overlay' }) });
    expect(defaultSelection(n)).toEqual({ base: 'a', overlays: [] });
    expect(defaultSelection(cfg({ o: layer(sources.wms, { kind: 'overlay' }) })).base).toBeUndefined();
  });
  it('follows `order`', () => {
    const m = MapSchema.parse({
      layers: { a: layer(sources.xyz), b: layer(sources.xyz) },
      order: ['b', 'a'],
    });
    expect(defaultSelection(m).base).toBe('b');
  });
});

describe('map.packs (A-032)', () => {
  const pack = {
    label: { de: 'Innenstadt' },
    bounds: [7.08, 50.7, 7.14, 50.75],
    min_zoom: 12,
    max_zoom: 17,
    layers: ['luft'],
    roles: ['kontrolle'],
  };
  const map = (p: unknown) => ({
    layers: { luft: layer(sources.pmtiles, { kind: 'overlay' }) },
    packs: { innenstadt: p },
  });

  it('parses a valid pack, with or without roles', () => {
    expect(MapSchema.safeParse(map(pack)).success).toBe(true);
    expect(MapSchema.safeParse(map({ ...pack, roles: undefined })).success).toBe(true);
  });

  it('refuses a pack without layers, with a fractional zoom, an unknown key or short bounds', () => {
    expect(MapSchema.safeParse(map({ ...pack, layers: [] })).success).toBe(false);
    expect(MapSchema.safeParse(map({ ...pack, min_zoom: 12.5 })).success).toBe(false);
    expect(MapSchema.safeParse(map({ ...pack, extra: 1 })).success).toBe(false);
    expect(MapSchema.safeParse(map({ ...pack, bounds: [1, 2, 3] })).success).toBe(false);
  });
});
