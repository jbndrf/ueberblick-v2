import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { MAP_SOURCE_TYPES } from '../../registry';
import { PACK_LIMITS, packTileType, sourceMaxZoom } from '../../registry/admin';
import { estimatePack } from '../../geo/tiles';
import { TemplateFileSchema } from '../file';
import { compile, NO_ASSETS } from './index';

const raw = import.meta.glob('./__fixtures__/base.yaml', { query: '?raw', import: 'default', eager: true });
const base = (): Record<string, unknown> => parse(Object.values(raw)[0] as string) as Record<string, unknown>;

const layers = {
  luft: { label: 'L', kind: 'overlay', source: { type: 'pmtiles', url: 'https://x.example/a.pmtiles' } },
  osm: { label: 'O', kind: 'base', source: { type: 'preset', preset: 'osm' } },
};
const pack = { label: 'S', bounds: [7.08, 50.7, 7.14, 50.75], min_zoom: 12, max_zoom: 16, layers: ['luft'] };
const compileMap = (packs: unknown) =>
  compile(TemplateFileSchema.parse({ ...base(), map: { layers, packs } }), { assets: NO_ASSETS });

describe('packs in compile (A-032)', () => {
  it('has the limits in the registry', () => {
    expect(PACK_LIMITS.keys).toEqual(['max_tiles', 'max_bytes', 'min_zoom', 'max_zoom']);
  });

  it('packs xyz, pmtiles and preset (A-033)', () => {
    expect(MAP_SOURCE_TYPES.entries.filter((e) => e.packable).map((e) => e.key)).toEqual([
      'xyz',
      'pmtiles',
      'preset',
    ]);
  });

  it('does not pack wms or geojson (WP-470)', () => {
    expect(MAP_SOURCE_TYPES.entries.filter((e) => !e.packable).map((e) => e.key)).toEqual(['wms', 'geojson']);
  });

  it('reads the tile type and the source maximum of a layer', () => {
    expect(packTileType({ source: { type: 'pmtiles', tile_type: 'vector' } })).toBe('vector');
    expect(packTileType({ source: { type: 'xyz' } })).toBe('raster');
    expect(sourceMaxZoom({ source: { type: 'preset', preset: 'osm' } })).toBe(19);
    expect(sourceMaxZoom({ source: { type: 'preset', preset: 'osm' }, maxzoom: 12 })).toBe(12);
    expect(sourceMaxZoom({ source: { type: 'pmtiles' } })).toBeUndefined();
  });

  it('accepts a valid pack on a pmtiles layer', () => {
    expect(compileMap({ stadt: pack }).ok).toBe(true);
  });

  it('accepts preset osm in a pack (the tile proxy makes it packable, A-033)', () => {
    expect(compileMap({ stadt: { ...pack, layers: ['osm'] } }).ok).toBe(true);
  });

  it('refuses a wms layer in a pack as not packable', () => {
    const wms = {
      label: 'W',
      kind: 'overlay',
      source: { type: 'wms', url: 'https://w.example/wms', layers: 'a' },
    };
    const r = compile(
      TemplateFileSchema.parse({
        ...base(),
        map: { layers: { ...layers, wms }, packs: { stadt: { ...pack, layers: ['wms'] } } },
      }),
      { assets: NO_ASSETS },
    );
    expect(r.ok ? [] : r.problems.map((p) => p.code)).toContain('pack_layer_not_packable');
  });

  it('caps the layer maximum at the source maximum in the estimate', () => {
    const e = estimatePack([7.08, 50.7, 7.14, 50.75], 10, 22, [
      { key: 'osm', tileType: packTileType(layers.osm), sourceMaxZoom: sourceMaxZoom(layers.osm) },
    ]);
    expect(e.layers[0]?.maxZoom).toBe(19);
  });

  it('gives every problem message in English and German', () => {
    const r = compileMap({ stadt: { ...pack, layers: ['nix'], roles: ['nix'] } });
    const ps = r.ok ? [] : r.problems.filter((p) => p.code.startsWith('pack_'));
    expect(ps.length).toBe(2);
    for (const p of ps) expect(p.message).toMatchObject({ en: expect.any(String), de: expect.any(String) });
  });
});
