// WP-650 (for lead-a's WP-351): the A-032 pack manifest is decoded in core, so the device and the server's builder
// type against one definition. Pure: it returns the manifest or a refusal with a reason (never throws).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodePackManifest } from './packs';

const layer = (over: Record<string, unknown> = {}) => ({
  layer: 'osm',
  tile_type: 'raster',
  url: '/api/p/demo/packs/h1/osm.pmtiles',
  bytes: 1000,
  sha256: 'a'.repeat(64),
  max_zoom: 17,
  tiles: 12,
  ...over,
});
const pack = (over: Record<string, unknown> = {}) => ({
  key: 'innen',
  label: 'Innenstadt',
  hash: 'h1',
  bounds: [7, 50, 8, 51],
  min_zoom: 12,
  max_zoom: 17,
  layers: [layer()],
  bytes: 1000,
  built_at: '2026-10-01T00:00:00Z',
  ...over,
});

describe('decodePackManifest', () => {
  it('accepts a valid manifest, including the per-layer max_zoom and tiles', () => {
    const r = decodePackManifest({ packs: [pack()] });
    expect(r).toEqual({ ok: true, manifest: { packs: [pack()] } });
  });

  it('accepts an empty list, a vector layer, and ignores unknown fields (the manifest may grow)', () => {
    expect(decodePackManifest({ packs: [] })).toEqual({ ok: true, manifest: { packs: [] } });
    const r = decodePackManifest({
      packs: [pack({ future: 1, layers: [layer({ tile_type: 'vector', terrain: true })] })],
      extra: 'x',
    });
    expect(r.ok && r.manifest.packs[0]?.layers[0]?.tile_type).toBe('vector');
    expect(r.ok && Object.keys(r.manifest.packs[0] ?? {})).not.toContain('future');
  });

  it.each([
    ['not an object', 'x', 'manifest'],
    ['no packs list', {}, 'packs'],
    ['a pack without a key', { packs: [pack({ key: undefined })] }, 'packs[0].key'],
    ['a pack without a hash', { packs: [pack({ hash: undefined })] }, 'packs[0].hash'],
    ['bounds of three numbers', { packs: [pack({ bounds: [1, 2, 3] })] }, 'packs[0].bounds'],
    [
      'a layer without max_zoom',
      { packs: [pack({ layers: [layer({ max_zoom: undefined })] })] },
      'packs[0].layers[0].max_zoom',
    ],
    [
      'a layer without tiles',
      { packs: [pack({ layers: [layer({ tiles: undefined })] })] },
      'packs[0].layers[0].tiles',
    ],
    [
      'a layer with a missing url',
      { packs: [pack({ layers: [layer({ url: undefined })] })] },
      'packs[0].layers[0].url',
    ],
  ])('refuses %s, naming the field', (_n, json, field) => {
    const r = decodePackManifest(json);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain(field);
  });

  it.each([
    ['bytes as a string', { packs: [pack({ bytes: '1000' })] }, 'packs[0].bytes'],
    ['a negative byte count', { packs: [pack({ bytes: -1 })] }, 'packs[0].bytes'],
    ['a fractional zoom', { packs: [pack({ min_zoom: 1.5 })] }, 'packs[0].min_zoom'],
    [
      'an unknown tile type',
      { packs: [pack({ layers: [layer({ tile_type: 'mesh' })] })] },
      'packs[0].layers[0].tile_type',
    ],
    ['a layer that is not an object', { packs: [pack({ layers: ['osm'] })] }, 'packs[0].layers[0]'],
    [
      'a digest of the wrong length',
      { packs: [pack({ layers: [layer({ sha256: 'abc' })] })] },
      'packs[0].layers[0].sha256',
    ],
    ['bounds with a NaN', { packs: [pack({ bounds: [7, 50, Number.NaN, 51] })] }, 'packs[0].bounds'],
  ])('refuses %s, naming the field', (_n, json, field) => {
    const r = decodePackManifest(json);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain(field);
  });

  it('never throws, whatever it is given', () => {
    fc.assert(
      fc.property(fc.anything(), (v) => {
        const r = decodePackManifest(v);
        expect(typeof r.ok).toBe('boolean');
      }),
    );
  });
});
