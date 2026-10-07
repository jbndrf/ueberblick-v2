// WP-621: the renderer draws the project's basemaps below the feature layers, lazily loads the pmtiles protocol and
// follows the participant's choice without touching the features.
import { describe, expect, it, vi } from 'vitest';
import { NO_ASSETS, compile } from '@ueberblick/core/compile';
import { MapSchema, type TemplateFile } from '@ueberblick/core/schema';
import { basemapErrors } from './basemaps';
import { validateStyleMin } from './style-spec';
import { mount, tick } from './renderer-fixture';

const config = MapSchema.parse({
  layers: {
    osm: { label: 'Straße', kind: 'base', source: { type: 'preset', preset: 'osm' }, on_at_start: true },
    luft: {
      label: 'Luftbild',
      kind: 'base',
      source: { type: 'xyz', url: 'https://t.example/{z}/{x}/{y}.jpg' },
    },
    dop: {
      label: 'DOP',
      kind: 'overlay',
      source: { type: 'wms', url: 'https://w.example/ows', layers: 'a' },
    },
    flur: { label: 'Flur', kind: 'overlay', source: { type: 'geojson', url: 'https://x.example/f.geojson' } },
  },
});
const pm = MapSchema.parse({
  layers: {
    osm: { label: 'Straße', kind: 'base', source: { type: 'preset', preset: 'osm' } },
    archiv: { label: 'Archiv', kind: 'overlay', source: { type: 'pmtiles', url: '/a.pmtiles' } },
  },
});

describe('maplibre-2d renderer: basemaps', () => {
  it('draws the start selection first, sources before layers, below the view layers', async () => {
    const { handle, calls } = mount();
    handle.setBasemaps?.(config, { base: 'osm', overlays: ['dop'] });
    await handle.ready;
    expect([...calls.sources].filter((s) => s.startsWith('bm-'))).toEqual(['bm-osm', 'bm-dop']);
    expect(calls.layers.filter((l) => l.startsWith('bm-'))).toEqual(['bm-osm', 'bm-dop']);
    const at = (id: string): number => calls.layers.indexOf(id);
    expect(Math.max(at('bm-osm'), at('bm-dop'))).toBeLessThan(at('ub-shape-fill'));
  });

  it('a map with no basemaps draws none', async () => {
    const { handle, calls } = mount();
    await handle.ready;
    expect(calls.layers.some((l) => l.startsWith('bm-'))).toBe(false);
  });

  it('switching the base swaps only the base; the new layer goes below the first view layer', async () => {
    const { handle, calls } = mount();
    handle.setBasemaps?.(config, { base: 'osm', overlays: ['dop'] });
    await handle.ready;
    handle.setBasemaps?.(config, { base: 'luft', overlays: ['dop'] });
    await tick();
    expect(calls.removedLayers).toContain('bm-osm');
    expect(calls.removedLayers).not.toContain('bm-dop');
    expect(calls.removedSources).toEqual(['bm-osm']);
    expect(calls.layers).toContain('bm-luft');
    expect(calls.moved).toContain('bm-luft');
  });

  it('toggling an overlay adds and removes just that overlay', async () => {
    const { handle, calls } = mount();
    handle.setBasemaps?.(config, { base: 'osm', overlays: [] });
    await handle.ready;
    handle.setBasemaps?.(config, { base: 'osm', overlays: ['flur'] });
    await tick();
    expect(calls.layers.some((l) => l.startsWith('bm-flur'))).toBe(true);
    handle.setBasemaps?.(config, { base: 'osm', overlays: [] });
    await tick();
    expect(calls.removedLayers.some((l) => l.startsWith('bm-flur'))).toBe(true);
    expect(calls.removedLayers).not.toContain('bm-osm');
  });

  it('does not touch the features when the choice changes', async () => {
    const { handle, calls } = mount();
    await handle.ready;
    const before = calls.updateData.length;
    handle.setBasemaps?.(config, { base: 'luft', overlays: [] });
    await tick();
    expect(calls.updateData.length).toBe(before);
  });

  it('keeps the basemaps when the view changes', async () => {
    const { handle, calls } = mount();
    handle.setBasemaps?.(config, { base: 'osm', overlays: [] });
    await handle.ready;
    handle.setView({} as never);
    expect(calls.removedLayers).not.toContain('bm-osm');
  });
});

describe('maplibre-2d renderer: the pmtiles protocol', () => {
  const loaded = () => vi.fn(() => Promise.resolve({ tile: () => undefined }));

  it('is not loaded for a project without a pmtiles layer', async () => {
    const loadPmtiles = loaded();
    const addProtocol = vi.fn();
    const { handle } = mount(undefined, undefined, { loadPmtiles, addProtocol });
    handle.setBasemaps?.(config, { base: 'osm', overlays: ['dop'] });
    await handle.ready;
    expect(loadPmtiles).not.toHaveBeenCalled();
    expect(addProtocol).not.toHaveBeenCalled();
  });

  it('is registered once, before the layer draws, however many maps use it', async () => {
    const loadPmtiles = loaded();
    const addProtocol = vi.fn();
    const first = mount(undefined, undefined, { loadPmtiles, addProtocol });
    first.handle.setBasemaps?.(pm, { base: 'osm', overlays: ['archiv'] });
    await first.handle.ready;
    expect(addProtocol).toHaveBeenCalledTimes(1);
    expect(addProtocol.mock.calls[0]?.[0]).toBe('pmtiles');
    expect(first.calls.layers).toContain('bm-archiv');
    const second = mount(undefined, undefined, { loadPmtiles, addProtocol });
    second.handle.setBasemaps?.(pm, { base: 'osm', overlays: ['archiv'] });
    await second.handle.ready;
    expect(addProtocol).toHaveBeenCalledTimes(1);
    expect(loadPmtiles).toHaveBeenCalledTimes(1);
  });

  it('is loaded when the person turns the pmtiles layer on later', async () => {
    const loadPmtiles = loaded();
    const addProtocol = vi.fn();
    const { handle, calls } = mount(undefined, undefined, { loadPmtiles, addProtocol });
    handle.setBasemaps?.(pm, { base: 'osm', overlays: [] });
    await handle.ready;
    expect(loadPmtiles).not.toHaveBeenCalled();
    handle.setBasemaps?.(pm, { base: 'osm', overlays: ['archiv'] });
    await tick();
    await tick();
    expect(loadPmtiles).toHaveBeenCalledTimes(1);
    expect(calls.layers).toContain('bm-archiv');
  });
});

describe('compile with the Style Spec check of the basemaps', () => {
  const file = (advanced: unknown): TemplateFile =>
    ({
      schema: 'ueberblick/1',
      template: { key: 't', version: '1.0.0' },
      map: {
        layers: {
          luft: {
            label: 'Luftbild',
            kind: 'base',
            source: { type: 'xyz', url: 'https://t.example/{z}/{x}/{y}.jpg' },
            advanced,
          },
        },
      },
    }) as unknown as TemplateFile;
  const mapStyles = (map: Parameters<typeof basemapErrors>[0]) =>
    basemapErrors(map, { validate: validateStyleMin });

  it('a bad advanced style is a compile problem that names the layer key', () => {
    const r = compile(file({ paint: { 'raster-opacity': 'very' } }), { assets: NO_ASSETS, mapStyles });
    expect(r.ok).toBe(false);
    const p = r.ok ? [] : r.problems.filter((x) => x.code === 'style_invalid');
    expect(p[0]?.path).toBe('map.layers.luft.advanced');
    expect(String(p[0]?.message)).toMatch(/luft.*raster-opacity/);
  });

  it('a good one compiles', () => {
    expect(compile(file({ paint: { 'raster-saturation': -0.5 } }), { assets: NO_ASSETS, mapStyles }).ok).toBe(
      true,
    );
  });
});
