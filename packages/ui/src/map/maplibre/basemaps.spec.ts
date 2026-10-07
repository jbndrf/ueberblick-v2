import { describe, expect, it } from 'vitest';
import { MapSchema } from '@ueberblick/core/schema';
import { defaultSelection, layersForRoles } from '@ueberblick/core/registry';
import { validateStyleMin, isExpressionFilter } from './style-spec';
import {
  applyBasemaps,
  basemapErrors,
  basemapSpecs,
  resolveSelection,
  type BasemapMap,
  type BasemapSelection,
} from './basemaps';

const raw = {
  start: { center: [10, 51], zoom: 9 },
  layers: {
    osm: {
      label: { de: 'Straße' },
      kind: 'base',
      source: { type: 'preset', preset: 'osm' },
      on_at_start: true,
    },
    luft: {
      label: { de: 'Luftbild' },
      kind: 'base',
      source: { type: 'xyz', url: 'https://t.example/{z}/{x}/{y}.jpg', tile_size: 512 },
      attribution: 'Land X',
      maxzoom: 20,
    },
    dop: {
      label: { de: 'DOP' },
      kind: 'overlay',
      source: { type: 'wms', url: 'https://wms.example/ows', layers: 'dop,flur' },
      opacity: 0.6,
    },
    grenzen: {
      label: { de: 'Grenzen' },
      kind: 'overlay',
      source: { type: 'geojson', url: 'https://x.example/g.geojson' },
    },
  },
};
const config = MapSchema.parse(raw);

interface Fake {
  map: BasemapMap;
  stack: string[];
  sources: Map<string, unknown>;
  order: string[];
}
/** A fake map with feature layers already on it; `stack` is the draw order, bottom first. */
function fake(): Fake {
  const stack = ['background', 'ub-shape-fill', 'ub-single'];
  const sources = new Map<string, unknown>([['ub-clusters', {}]]);
  const order: string[] = [];
  const map: BasemapMap = {
    addSource(id, spec) {
      order.push(`source:${id}`);
      sources.set(id, spec);
    },
    addLayer(spec) {
      const id = (spec as { id: string }).id;
      order.push(`layer:${id}`);
      stack.push(id);
    },
    removeLayer(id) {
      stack.splice(stack.indexOf(id), 1);
    },
    removeSource(id) {
      sources.delete(id);
    },
    moveLayer(id, before) {
      stack.splice(stack.indexOf(id), 1);
      stack.splice(before === undefined ? stack.length : stack.indexOf(before), 0, id);
    },
  };
  return { map, stack, sources, order };
}
const ids = (stack: string[]) => stack.filter((i) => i.startsWith('bm-'));

describe('resolveSelection', () => {
  it('starts from the default and honours a valid choice', () => {
    expect(resolveSelection(config, undefined)).toEqual(defaultSelection(config));
    expect(resolveSelection(config, { base: 'luft', overlays: ['dop'] })).toEqual({
      base: 'luft',
      overlays: ['dop'],
    });
  });
  it('drops unknown or wrongly kinded keys', () => {
    expect(resolveSelection(config, { base: 'dop', overlays: ['luft', 'nope', 'grenzen'] })).toEqual({
      base: 'osm',
      overlays: ['grenzen'],
    });
  });
});

describe('basemapSpecs', () => {
  it('OSM preset renders as raster with its attribution and max zoom', () => {
    const { sources, layers } = basemapSpecs(config, { base: 'osm', overlays: [] });
    expect(sources).toHaveLength(1);
    const spec = sources[0]?.spec as Record<string, unknown>;
    expect(spec).toMatchObject({
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      attribution: expect.stringContaining('OpenStreetMap'),
      maxzoom: 19,
    });
    expect(layers.map((l) => (l as { type: string }).type)).toEqual(['raster']);
  });
  it('a configured attribution, tile size and zoom range reach the source and layer', () => {
    const { sources, layers } = basemapSpecs(config, { base: 'luft', overlays: [] });
    expect(sources[0]?.spec).toMatchObject({ tileSize: 512, attribution: 'Land X', maxzoom: 20 });
    expect(layers[0]).toMatchObject({ maxzoom: 20 });
  });
  it('WMS becomes a tile URL with the bbox placeholder and opacity', () => {
    const { sources, layers } = basemapSpecs(config, { base: undefined, overlays: ['dop'] });
    const url = (sources[0]?.spec as { tiles: string[] }).tiles[0] ?? '';
    expect(url).toContain('https://wms.example/ows?service=WMS&request=GetMap&version=1.3.0');
    expect(url).toContain('layers=dop%2Cflur');
    expect(url).toContain('crs=EPSG:3857');
    expect(url).toContain('bbox={bbox-epsg-3857}');
    expect(layers[0]).toMatchObject({ paint: { 'raster-opacity': 0.6 } });
  });
  it('GeoJSON draws fill, line and point layers', () => {
    const { sources, layers } = basemapSpecs(config, { base: undefined, overlays: ['grenzen'] });
    expect(sources[0]?.spec).toMatchObject({ type: 'geojson', data: 'https://x.example/g.geojson' });
    expect(layers.map((l) => (l as { type: string }).type).sort()).toEqual(['circle', 'fill', 'line']);
  });
  it('draws base first, then overlays in authored order', () => {
    const { layers } = basemapSpecs(config, { base: 'luft', overlays: ['grenzen', 'dop'] });
    expect((layers[0] as { id: string }).id).toBe('bm-luft');
    expect(layers.map((l) => (l as { id: string }).id).indexOf('bm-dop')).toBeLessThan(
      layers.map((l) => (l as { id: string }).id).indexOf('bm-grenzen-fill'),
    );
  });
  it('advanced paint reaches the layers it fits', () => {
    const m = MapSchema.parse({
      layers: {
        g: {
          label: { de: 'G' },
          kind: 'overlay',
          source: { type: 'geojson', url: 'https://x.example/g.geojson' },
          advanced: { paint: { 'line-color': '#f00', 'line-dasharray': [2, 1] } },
        },
      },
    });
    const { layers } = basemapSpecs(m, { base: undefined, overlays: ['g'] });
    const line = layers.find((l) => (l as { type: string }).type === 'line') as {
      paint: Record<string, unknown>;
    };
    const fill = layers.find((l) => (l as { type: string }).type === 'fill') as {
      paint: Record<string, unknown>;
    };
    expect(line.paint['line-color']).toBe('#f00');
    expect(fill.paint['line-color']).toBeUndefined();
  });
});

describe('applyBasemaps', () => {
  const sel = (base: string | undefined, overlays: string[]): BasemapSelection => ({ base, overlays });

  it('base plus two overlays: sources before layers, all below the feature layers', () => {
    const f = fake();
    applyBasemaps(f.map, config, undefined, sel('osm', ['dop', 'grenzen']), 'ub-shape-fill');
    const firstLayer = f.order.findIndex((o) => o.startsWith('layer:'));
    const lastSource = f.order.map((o) => o.startsWith('source:')).lastIndexOf(true);
    expect(lastSource).toBeLessThan(firstLayer);
    expect(f.stack.slice(0, 2)).toEqual(['background', 'bm-osm']);
    expect(f.stack.indexOf('bm-dop')).toBeLessThan(f.stack.indexOf('ub-shape-fill'));
    expect(f.stack.indexOf('bm-grenzen-point')).toBeLessThan(f.stack.indexOf('ub-shape-fill'));
    expect(f.stack.slice(-2)).toEqual(['ub-shape-fill', 'ub-single']);
    expect(f.sources.has('bm-osm') && f.sources.has('bm-dop') && f.sources.has('bm-grenzen')).toBe(true);
  });

  it('switching the base swaps only the base layer', () => {
    const f = fake();
    const a = sel('osm', ['dop']);
    applyBasemaps(f.map, config, undefined, a, 'ub-shape-fill');
    const overlayBefore = f.stack.indexOf('bm-dop');
    f.order.length = 0;
    applyBasemaps(f.map, config, a, sel('luft', ['dop']), 'ub-shape-fill');
    expect(f.order).toEqual(['source:bm-luft', 'layer:bm-luft']);
    expect(f.sources.has('bm-osm')).toBe(false);
    expect(ids(f.stack)).toEqual(['bm-luft', 'bm-dop']);
    expect(f.stack.indexOf('bm-luft')).toBeLessThan(f.stack.indexOf('bm-dop'));
    expect(overlayBefore).toBeGreaterThan(0);
    expect(f.stack.slice(-2)).toEqual(['ub-shape-fill', 'ub-single']);
  });

  it('turning an overlay off removes its layers and source', () => {
    const f = fake();
    applyBasemaps(f.map, config, undefined, sel('osm', ['grenzen']), 'ub-shape-fill');
    applyBasemaps(f.map, config, sel('osm', ['grenzen']), sel('osm', []), 'ub-shape-fill');
    expect(ids(f.stack)).toEqual(['bm-osm']);
    expect(f.sources.has('bm-grenzen')).toBe(false);
  });

  it('role-filtered layers are never drawn', () => {
    const f = fake();
    const withRoles = MapSchema.parse({
      layers: { ...raw.layers, dop: { ...raw.layers.dop, roles: ['verwaltung'] } },
    });
    const mine = layersForRoles(withRoles, ['kontrolle']);
    applyBasemaps(f.map, mine, undefined, resolveSelection(mine, sel('osm', ['dop'])), 'ub-shape-fill');
    expect(ids(f.stack)).toEqual(['bm-osm']);
  });
});

describe('basemapErrors (Style Spec)', () => {
  const spec = { validate: validateStyleMin, isExpressionFilter };
  it('accepts a valid advanced style', () => {
    const m = MapSchema.parse({
      layers: {
        a: {
          ...raw.layers.luft,
          advanced: { paint: { 'raster-saturation': -0.5 }, layout: { visibility: 'visible' } },
        },
      },
    });
    expect(basemapErrors(m, spec)).toEqual([]);
  });
  it('reports the Style Spec message, with the layer key', () => {
    const m = MapSchema.parse({
      layers: { a: { ...raw.layers.luft, advanced: { paint: { 'raster-opacity': 'very' } } } },
    });
    const errors = basemapErrors(m, spec);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.layer).toBe('a');
    expect(errors[0]?.message).toMatch(/raster-opacity/);
    expect(errors[0]?.message).toMatch(/number/);
  });
  it('reports an advanced key that fits no layer of the source', () => {
    const m = MapSchema.parse({
      layers: { a: { ...raw.layers.luft, advanced: { paint: { 'fill-color': '#fff' } } } },
    });
    expect(basemapErrors(m, spec)[0]?.message).toMatch(/fill-color/);
  });
});
