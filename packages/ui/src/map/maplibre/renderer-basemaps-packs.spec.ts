// WP-662: the pack protocol registers through the same `addProtocol` seam as pmtiles, once per library.
import { describe, expect, it, vi } from 'vitest';
import { MapSchema } from '@ueberblick/core/schema';
import type { MlMap } from './api';
import { basemapSpecs } from './basemaps';
import { createPackProtocol, type PackRouting } from './packs';
import { createBasemapSync } from './renderer-basemaps';

const config = MapSchema.parse({
  layers: {
    osm: { label: 'Straße', kind: 'base', source: { type: 'preset', preset: 'osm' }, on_at_start: true },
  },
});

function run(addProtocol: (n: string, h: unknown) => void, packProtocol?: PackRouting) {
  const map = {
    addSource: vi.fn(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    removeSource: vi.fn(),
    moveLayer: vi.fn(),
  };
  const sync = createBasemapSync({
    loadPmtiles: undefined,
    addProtocol,
    packProtocol,
    map: () => map as unknown as MlMap,
    api: () => undefined,
    destroyed: () => false,
    lowestViewLayer: () => undefined,
  });
  sync.want(config, { base: 'osm', overlays: [] });
  return sync.sync();
}

describe('basemap sync: the pack protocol', () => {
  it('registers once through addProtocol, however many maps use it', async () => {
    const add = vi.fn();
    const packs = createPackProtocol({ packs: undefined });
    await run(add, packs);
    await run(add, packs);
    expect(add.mock.calls).toEqual([['ubtile', packs.handler]]);
  });

  it('registers nothing when no pack protocol is given', async () => {
    const add = vi.fn();
    await run(add);
    expect(add).not.toHaveBeenCalled();
  });
});

describe('basemaps: layers with a pack draw through the pack protocol', () => {
  const two = MapSchema.parse({
    layers: {
      osm: { label: 'Straße', kind: 'base', source: { type: 'preset', preset: 'osm' } },
      luft: {
        label: 'Luft',
        kind: 'overlay',
        source: { type: 'xyz', url: 'https://t.example/{z}/{x}/{y}.jpg' },
      },
    },
  });
  const tilesOf = (specs: ReturnType<typeof basemapSpecs>, id: string): unknown =>
    (specs.sources.find((s) => s.id === id)?.spec as { tiles: string[] }).tiles;

  it('replaces the tile URL and registers the layer template, only for layers with a pack', () => {
    const packs = createPackProtocol({ packs: undefined, hasLayer: (k) => k === 'luft' });
    const specs = basemapSpecs(two, { base: 'osm', overlays: ['luft'] }, packs);
    expect(tilesOf(specs, 'bm-luft')).toEqual(['ubtile://luft/{z}/{x}/{y}']);
    expect(tilesOf(specs, 'bm-osm')).toEqual(['https://tile.openstreetmap.org/{z}/{x}/{y}.png']);
  });

  it('leaves every URL alone without packs', () => {
    expect(tilesOf(basemapSpecs(two, { base: 'osm', overlays: ['luft'] }), 'bm-luft')).toEqual([
      'https://t.example/{z}/{x}/{y}.jpg',
    ]);
  });

  it('draws a routed layer through the map sync with the protocol registered once', async () => {
    const add = vi.fn();
    const packs = createPackProtocol({ packs: undefined, hasLayer: () => true });
    const map = {
      addSource: vi.fn(),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      moveLayer: vi.fn(),
    };
    const sync = createBasemapSync({
      loadPmtiles: undefined,
      addProtocol: add,
      packProtocol: packs,
      map: () => map as unknown as MlMap,
      api: () => undefined,
      destroyed: () => false,
      lowestViewLayer: () => undefined,
    });
    sync.want(two, { base: 'osm', overlays: [] });
    await sync.sync();
    expect(add).toHaveBeenCalledWith('ubtile', packs.handler);
    expect(map.addSource.mock.calls[0]?.[1]).toMatchObject({ tiles: ['ubtile://osm/{z}/{x}/{y}'] });
  });
});
