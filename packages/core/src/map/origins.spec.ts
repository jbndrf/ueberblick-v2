import { describe, expect, it } from 'vitest';
import { mapOrigins } from './origins';

type Src = { type: string } & Record<string, unknown>;
const layer = (source: Src) => ({ kind: 'base', source });
const mapOf = (...sources: Src[]) => ({
  layers: Object.fromEntries(sources.map((s, i) => [`l${i}`, layer(s)])),
});

describe('mapOrigins', () => {
  it('gives the origin of a remote GeoJSON file, the one layer kind the browser still fetches directly', () => {
    const map = mapOf({ type: 'geojson', url: 'https://data.example.org/x.geojson?y=1' });
    expect(mapOrigins(map)).toEqual(['https://data.example.org']);
  });

  it('gives nothing for layers the tile proxy serves: xyz, wms, preset, raster and vector pmtiles (WP-971)', () => {
    const map = mapOf(
      { type: 'xyz', url: 'https://tiles.example.org/{z}/{x}/{y}.png' },
      { type: 'xyz', url: 'https://{s}.tiles.example.org/{z}/{x}/{y}.png' },
      { type: 'wms', url: 'https://wms.example.org:8443/service', layers: 'a' },
      { type: 'preset', preset: 'osm' },
      { type: 'pmtiles', url: 'https://cdn.example.org/a/b.pmtiles' },
      { type: 'pmtiles', url: 'https://cdn.example.org/a/v.pmtiles', vector: true },
    );
    expect(mapOrigins(map)).toEqual([]);
    expect(mapOrigins({ layers: {} })).toEqual([]);
  });

  it('expands {s} in the host to the apex and a subdomain wildcard', () => {
    expect(mapOrigins(mapOf({ type: 'geojson', url: 'https://{s}.data.example.org/x.geojson' }))).toEqual([
      'https://*.data.example.org',
      'https://data.example.org',
    ]);
  });

  it('gives nothing for relative or same-origin paths', () => {
    expect(mapOrigins(mapOf({ type: 'geojson', url: '/x.geojson' }))).toEqual([]);
    expect(mapOrigins(mapOf({ type: 'geojson', url: '//evil.example/a.geojson' }))).toEqual([]);
  });

  it('refuses schemes and hosts that would widen the policy', () => {
    const bad = [
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      'blob:https://a.example/x',
      'ftp://a.example/x',
      'http://tiles.example.org/{z}/{x}/{y}.png',
      'https://*.example.org/x',
      'https://*/x',
      "https://a.example' 'unsafe-inline",
      'https://a.example; script-src *',
      'https://[::1]/x',
      "'self'",
      '*',
      '',
    ];
    for (const url of bad) expect(mapOrigins(mapOf({ type: 'geojson', url })), url).toEqual([]);
  });

  it('allows plain http only for localhost', () => {
    expect(mapOrigins(mapOf({ type: 'geojson', url: 'http://localhost:8080/x.geojson' }))).toEqual([
      'http://localhost:8080',
    ]);
  });

  it('sorts and de-duplicates', () => {
    const map = mapOf(
      { type: 'geojson', url: 'https://b.example.org/1.geojson' },
      { type: 'geojson', url: 'https://a.example.org/2.geojson' },
      { type: 'geojson', url: 'https://b.example.org/3.geojson' },
    );
    expect(mapOrigins(map)).toEqual(['https://a.example.org', 'https://b.example.org']);
  });

  it('ignores an unknown preset and a layer without a source url', () => {
    expect(mapOrigins(mapOf({ type: 'preset', preset: 'nope' }, { type: 'geojson' }))).toEqual([]);
  });

  it('every returned origin is a bare origin whatever the input', () => {
    const noise = [
      'https://a.b/',
      'https://a.b:99/x',
      'https://x y/',
      'https://a.b\n/x',
      'https://a.b@c.d/x',
    ];
    for (const url of noise)
      for (const o of mapOrigins(mapOf({ type: 'geojson', url })))
        expect(o).toMatch(/^https?:\/\/(\*\.)?[a-z0-9.-]+(:\d+)?$/);
  });
});
