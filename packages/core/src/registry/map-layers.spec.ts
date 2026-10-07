import { describe, expect, it } from 'vitest';
import { mapOrigins } from '../map/origins';
import { MapLayerSchema } from '../schema/map';
import {
  DEFAULT_BASE_LAYER,
  MAP_PRESETS,
  hasBaseLayer,
  MAP_SOURCE_TYPES,
  isSameOriginPath,
} from './map-layers';
import {
  MAP_WMS_PRESETS,
  TILE_HOST_POLICIES,
  TILE_PROXY_LIMITS,
  tileHostPackCap,
  tileProxyLimit,
} from './tile-proxy';

describe('MAP_SOURCE_TYPES (A-033)', () => {
  it('packs the sources a proxy can cache, and pmtiles', () => {
    expect(MAP_SOURCE_TYPES.entries.filter((e) => e.packable).map((e) => e.key)).toEqual([
      'xyz',
      'pmtiles',
      'preset',
    ]);
  });

  it('proxies every tile source and nothing else', () => {
    expect(MAP_SOURCE_TYPES.entries.filter((e) => e.proxied).map((e) => e.key)).toEqual([
      'xyz',
      'wms',
      'pmtiles',
      'preset',
    ]);
  });

  it('never packs what the browser loads itself', () => {
    for (const e of MAP_SOURCE_TYPES.entries) if (e.packable) expect(e.proxied).toBe(true);
  });
});

describe('tile proxy limits', () => {
  it('has positive values', () => {
    for (const l of TILE_PROXY_LIMITS.keys) expect(tileProxyLimit(l)).toBeGreaterThan(0);
  });
});

describe('tileHostPackCap', () => {
  const osm = TILE_HOST_POLICIES.get('osm').pack_max_tiles;
  it('caps OSM and its subdomains', () => {
    expect(tileHostPackCap('https://tile.openstreetmap.org/{z}/{x}/{y}.png')).toBe(osm);
    expect(tileHostPackCap('https://a.tile.openstreetmap.org/{z}/{x}/{y}.png')).toBe(osm);
  });
  it('leaves other hosts alone, also lookalikes', () => {
    expect(tileHostPackCap('https://tiles.example.org/{z}/{x}/{y}.png')).toBeUndefined();
    expect(tileHostPackCap('https://tile.openstreetmap.org.example.com/x')).toBeUndefined();
    expect(tileHostPackCap('/relative/{z}')).toBeUndefined();
  });
});

describe('isSameOriginPath', () => {
  it('is true for a path on this instance, false for a URL that names a host (also `//host`)', () => {
    expect(isSameOriginPath('/tiles/a.pmtiles')).toBe(true);
    expect(isSameOriginPath('//evil.example/x')).toBe(false);
    expect(isSameOriginPath('https://tiles.example/a')).toBe(false);
    expect(isSameOriginPath('a/b')).toBe(false);
    for (const bad of [
      '/\\evil.com/x',
      '/\t/evil.com',
      '/\n/evil.com',
      '/\r/evil.com',
      '/a\\b',
      '/a\u007f',
      '/'.concat('\u0000'),
    ])
      expect(isSameOriginPath(bad)).toBe(false);
  });
});

describe('map presets (v3 PRESET_SOURCES, WP-385)', () => {
  it('lists v3 order: osm, osm_de, carto_light, carto_dark; no commercial imagery (Q22)', () => {
    expect([...MAP_PRESETS.keys]).toEqual(['osm', 'osm_de', 'carto_light', 'carto_dark']);
    expect([...MAP_WMS_PRESETS.keys]).toEqual(['nrw_dop', 'nrw_dtk']);
  });
  it('every tile preset is an https template with z, x and y', () => {
    for (const p of MAP_PRESETS.entries) {
      expect(p.tiles[0]).toMatch(/^https:\/\//);
      for (const k of ['{z}', '{x}', '{y}']) expect(p.tiles[0]).toContain(k);
    }
  });
  it('a layer made from a WMS preset is an ordinary wms layer that the file schema accepts', () => {
    for (const p of MAP_WMS_PRESETS.entries) {
      const layer = {
        label: p.key,
        kind: 'base',
        source: {
          type: 'wms',
          url: p.url,
          layers: p.layers,
          version: p.version,
          format: p.format,
          transparent: p.transparent,
        },
        attribution: p.attribution,
      };
      expect(MapLayerSchema.safeParse(layer).success).toBe(true);
      expect(mapOrigins({ layers: { x: layer } })).toEqual([]); // proxied: the browser never asks the provider
    }
  });
  it('tile presets are proxied like any xyz layer: no provider origin in the CSP', () => {
    const source = { type: 'preset', preset: 'carto_dark' };
    expect(mapOrigins({ layers: { x: { source } } })).toEqual([]);
  });
});

describe('the default base (v3 MapCanvas `default-osm`)', () => {
  it('is one reserved key that names an existing preset', () => {
    expect(DEFAULT_BASE_LAYER.key).toBe('default-osm');
    expect(MAP_PRESETS.has(DEFAULT_BASE_LAYER.preset)).toBe(true);
  });
  it('hasBaseLayer: true only when some layer is a base', () => {
    expect(hasBaseLayer({ layers: {} })).toBe(false);
    expect(hasBaseLayer({ layers: { a: { kind: 'overlay' } } })).toBe(false);
    expect(hasBaseLayer({ layers: { a: { kind: 'overlay' }, b: { kind: 'base' } } })).toBe(true);
  });
});
