// WP-689 (A-033): proxied layers are drawn from the project's tile proxy; nothing leaves the origin.
import { describe, expect, it, vi } from 'vitest';
import { MapSchema } from '@ueberblick/core/schema';
import { MAP_SOURCE_TYPES } from '@ueberblick/core/registry';
import type { MlMap } from './api';
import { basemapSpecs, type BasemapSelection, type TileProxy } from './basemaps';
import { createPackProtocol } from './packs';
import { createBasemapSync } from './renderer-basemaps';

const proxy: TileProxy = { project: 'demo', origin: 'https://app.example' };
const config = MapSchema.parse({
  layers: {
    osm: { label: 'Straße', kind: 'base', source: { type: 'preset', preset: 'osm' } },
    luft: {
      label: 'Luft',
      kind: 'base',
      source: { type: 'xyz', url: 'https://t.example/{z}/{x}/{y}.jpg', tile_size: 512 },
    },
    dop: {
      label: 'DOP',
      kind: 'overlay',
      source: { type: 'wms', url: 'https://wms.example/ows', layers: 'a' },
    },
    pr: { label: 'PR', kind: 'overlay', source: { type: 'pmtiles', url: 'https://p.example/a.pmtiles' } },
    pv: {
      label: 'PV',
      kind: 'overlay',
      source: { type: 'pmtiles', url: 'https://p.example/v.pmtiles', tile_type: 'vector', source_layer: 'x' },
    },
    pl: { label: 'PL', kind: 'overlay', source: { type: 'pmtiles', url: '/files/a.pmtiles' } },
    own: { label: 'Own', kind: 'overlay', source: { type: 'xyz', url: '/tiles/{z}/{x}/{y}.png' } },
    ownw: { label: 'OwnW', kind: 'overlay', source: { type: 'wms', url: '/ows', layers: 'a' } },
    geo: { label: 'Geo', kind: 'overlay', source: { type: 'geojson', url: 'https://g.example/g.geojson' } },
  },
});
const all: BasemapSelection = { base: undefined, overlays: ['dop', 'pr', 'pv', 'pl', 'own', 'ownw', 'geo'] };
const specOf = (k: string, sel = all): Record<string, unknown> =>
  basemapSpecs(config, sel, undefined, proxy).sources.find((s) => s.id === `bm-${k}`)?.spec as Record<
    string,
    unknown
  >;

describe('basemapSpecs with the tile proxy', () => {
  it('xyz and preset use the {z}/{x}/{y} template on the proxy', () => {
    expect(specOf('luft', { base: 'luft', overlays: [] })).toMatchObject({
      type: 'raster',
      tileSize: 512,
      tiles: ['https://app.example/api/p/demo/tiles/luft/{z}/{x}/{y}'],
    });
    expect(specOf('osm', { base: 'osm', overlays: [] })).toMatchObject({
      tiles: ['https://app.example/api/p/demo/tiles/osm/{z}/{x}/{y}'],
      maxzoom: 19,
    });
  });
  it('wms uses the proxy bbox/width/height/crs form', () => {
    expect(specOf('dop')['tiles']).toEqual([
      'https://app.example/api/p/demo/wms/dop?bbox={bbox-epsg-3857}&width=256&height=256&crs=EPSG:3857',
    ]);
  });
  it('a remote pmtiles archive is an xyz-like raster or vector source on the per-tile route', () => {
    expect(specOf('pr')).toMatchObject({
      type: 'raster',
      tiles: ['https://app.example/api/p/demo/tiles/pr/{z}/{x}/{y}'],
    });
    expect(specOf('pv')).toMatchObject({
      type: 'vector',
      tiles: ['https://app.example/api/p/demo/tiles/pv/{z}/{x}/{y}'],
    });
    expect(specOf('pr')['url']).toBeUndefined();
  });
  it('a pmtiles layer with a pack on the device goes through the pack protocol, remote or self-hosted', () => {
    const packs = createPackProtocol({ packs: undefined, hasLayer: (k) => k === 'pr' || k === 'pl' });
    const spec = (k: string): Record<string, unknown> =>
      basemapSpecs(config, all, packs, proxy).sources.find((s) => s.id === `bm-${k}`)?.spec as Record<
        string,
        unknown
      >;
    expect(spec('pr')).toMatchObject({ type: 'raster', tiles: ['ubtile://pr/{z}/{x}/{y}'] });
    expect(spec('pl')).toMatchObject({ type: 'raster', tiles: ['ubtile://pl/{z}/{x}/{y}'] });
    expect(spec('pl')['url']).toBeUndefined();
    expect(spec('pv')['tiles']).toEqual(['https://app.example/api/p/demo/tiles/pv/{z}/{x}/{y}']);
  });
  it('self-hosted paths and geojson stay direct', () => {
    expect(specOf('pl')).toMatchObject({ url: 'pmtiles:///files/a.pmtiles' });
    expect(specOf('own')['tiles']).toEqual(['/tiles/{z}/{x}/{y}.png']);
    expect(String((specOf('ownw')['tiles'] as string[])[0])).toContain('/ows?service=WMS');
    expect(specOf('geo')).toMatchObject({ data: 'https://g.example/g.geojson' });
  });
  it('no tile URL of a proxied source type leaves the origin, whatever the layer', () => {
    const proxied = new Set(MAP_SOURCE_TYPES.entries.filter((e) => e.proxied).map((e) => e.key));
    for (const [key, layer] of Object.entries(config.layers)) {
      if (!proxied.has(layer.source.type as never)) continue;
      const own = 'url' in layer.source ? String(layer.source.url) : '';
      if (own.startsWith('/')) continue;
      const alone: BasemapSelection =
        layer.kind === 'base' ? { base: key, overlays: [] } : { base: undefined, overlays: [key] };
      const tiles = (specOf(key, alone)['tiles'] ?? []) as string[];
      expect(tiles.length, key).toBeGreaterThan(0);
      for (const t of tiles) expect(new URL(t.replace(/[{}]/g, '')).origin, key).toBe(proxy.origin);
    }
  });
});

describe('the pack protocol fallback asks the proxy', () => {
  it('a tile not in the pack is fetched from the proxy URL, not the provider', async () => {
    const fetchTile = vi.fn(async () => new ArrayBuffer(4));
    const packs = createPackProtocol({ packs: undefined, hasLayer: () => true, fetchTile });
    const map = {
      addSource: vi.fn(),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      moveLayer: vi.fn(),
    };
    const sync = createBasemapSync({
      loadPmtiles: undefined,
      addProtocol: vi.fn(),
      packProtocol: packs,
      proxy,
      map: () => map as unknown as MlMap,
      api: () => undefined,
      destroyed: () => false,
      lowestViewLayer: () => undefined,
    });
    sync.want(config, { base: 'luft', overlays: [] });
    await sync.sync();
    await packs.handler({ url: 'ubtile://luft/3/4/5' }, new AbortController());
    expect(fetchTile).toHaveBeenCalledWith(
      'https://app.example/api/p/demo/tiles/luft/3/4/5',
      expect.anything(),
    );
  });
});
