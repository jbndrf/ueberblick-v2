import { describe, expect, it } from 'vitest';
import type { MapConfig } from '@ueberblick/core';
import {
  baseNames,
  isProxied,
  layerRows,
  validateLayerDraft,
  validateSource,
  type LayerRowData,
  type LayerSource,
} from './layers-model';
import { draftOf, emptyForm, formOf, patchOf, sourceOf } from './layers-forms';

const MAP: MapConfig = {
  layers: {
    osm: {
      label: { de: 'Straße', en: 'Street' },
      kind: 'base',
      source: { type: 'preset', preset: 'osm' },
      on_at_start: true,
    },
    flur: {
      label: 'Flur',
      kind: 'overlay',
      source: { type: 'wms', url: 'https://w.example.org/ows', layers: 'a' },
      opacity: 0.25,
      roles: ['bauhof'],
    },
    eigen: { label: 'Eigen', kind: 'overlay', source: { type: 'pmtiles', url: '/tiles/a.pmtiles' } },
  },
  order: ['flur', 'osm'],
} as MapConfig;

describe('layerRows', () => {
  it('lists the layers in draw order, in the page language, with opacity in percent', () => {
    const rows = layerRows(MAP, 'en');
    expect(rows.map((r) => r.key)).toEqual(['flur', 'osm', 'eigen']);
    expect(rows[1]).toMatchObject({ label: 'Street', kind: 'base', onAtStart: true, type: 'preset' });
    expect(rows[0]).toMatchObject({ opacity: 25, roles: ['bauhof'], url: 'https://w.example.org/ows' });
    expect(baseNames(rows)).toEqual(['Street']);
    expect(layerRows(undefined, 'de')).toEqual([]);
  });
  it('says which layers the tile proxy serves: not a path on this server, not GeoJSON', () => {
    expect(layerRows(MAP, 'de').map((r) => r.proxied)).toEqual([true, true, false]);
    expect(isProxied({ type: 'geojson', url: 'https://x.org/a.json' })).toBe(false);
  });
});

describe('validation', () => {
  const s = (o: Record<string, unknown>) => o as LayerSource;
  it('the source checks of every type', () => {
    expect(validateSource(s({ type: 'xyz', url: '' }))).toBe('url_required');
    expect(validateSource(s({ type: 'xyz', url: 'ftp://x/{z}/{x}/{y}' }))).toBe('url_invalid');
    expect(validateSource(s({ type: 'xyz', url: '/t/{z}/{x}/{y}.png' }))).toBeNull();
    expect(validateSource(s({ type: 'wms', url: 'https://x.org/w', layers: ' ' }))).toBe(
      'wms_layers_required',
    );
    expect(validateSource(s({ type: 'geojson', url: '//evil.example/x' }))).toBe('url_invalid');
    expect(validateSource(s({ type: 'preset', preset: 'osm' }))).toBeNull();
  });
  it('a zoom outside 0 to 24, or min above max, is refused', () => {
    const base = { label: 'A', kind: 'overlay', source: s({ type: 'geojson', url: '/a.json' }) } as const;
    expect(validateLayerDraft({ ...base, minzoom: 3, maxzoom: 9 })).toBeNull();
    expect(validateLayerDraft({ ...base, minzoom: 9, maxzoom: 3 })).toBe('zoom_range');
    expect(validateLayerDraft({ ...base, maxzoom: 30 })).toBe('zoom_range');
  });
});

describe('forms', () => {
  it('a new layer is an overlay unless "als Basis"; v3 defaults for WMS', () => {
    const f = { ...emptyForm(), name: ' A ', url: ' https://w.org/ows ', wmsLayers: 'x' };
    expect(draftOf('wms', f)).toEqual({
      label: 'A',
      kind: 'overlay',
      source: {
        type: 'wms',
        url: 'https://w.org/ows',
        layers: 'x',
        version: '1.1.1',
        format: 'image/png',
        transparent: true,
      },
    });
    expect(draftOf('xyz', { ...f, asBase: true, attribution: ' ©  ' }).kind).toBe('base');
  });
  it('the edit form round-trips a layer; emptied settings become null (take away)', () => {
    const row = layerRows(MAP, 'de')[0] as LayerRowData;
    const patch = patchOf(row, { ...formOf(row), roles: [], minzoom: '', opacity: 100 });
    expect(patch).toMatchObject({ roles: null, minzoom: null, maxzoom: null, opacity: 1, attribution: null });
    expect(sourceOf('wms', formOf(row))).toMatchObject({ type: 'wms', layers: 'a', version: '1.1.1' });
  });
});
