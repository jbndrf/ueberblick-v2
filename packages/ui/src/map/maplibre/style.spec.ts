import { describe, expect, it } from 'vitest';
import type { View } from '@ueberblick/core/model';
import { DEFAULT_MARKER_COLOR } from '@ueberblick/core/registry';
import { LAYER_IDS, LAYERS } from './layers';
import { MapStyleError, pointPropertyKeys, resolveLayers } from './style';

const viewWith = (style: unknown, renderer = 'maplibre-2d'): View =>
  ({ layers: { main: { renderer, style } } }) as unknown as View;
const ids = (defs: readonly { spec: unknown }[]): string[] => defs.map((d) => (d.spec as { id: string }).id);

const single = {
  id: 'ub-single',
  type: 'circle',
  source: 'ub-clusters',
  filter: ['!', ['has', 'clusterId']],
  paint: { 'circle-color': ['case', ['==', ['get', 'status'], 'open'], '#f00', '#0a0'] },
};

describe('resolveLayers', () => {
  it('returns the defaults without a style', () => {
    expect(resolveLayers({} as View)).toBe(LAYERS);
    expect(resolveLayers(viewWith(undefined))).toBe(LAYERS);
  });

  it('a style layer replaces the default of the same id and keeps the rest', () => {
    const out = resolveLayers(viewWith({ layers: [single] }));
    expect([...ids(out)].sort()).toEqual([...ids(LAYERS)].sort());
    const replaced = out.find((d) => (d.spec as { id: string }).id === 'ub-single');
    expect((replaced?.spec as typeof single).paint['circle-color']).toEqual(single.paint['circle-color']);
    // sources stay declared exactly once, by the defaults
    expect(out.filter((d) => d.source !== undefined)).toHaveLength(2);
  });

  it('a new layer id is appended', () => {
    const extra = { ...single, id: 'mine' };
    expect(ids(resolveLayers(viewWith({ layers: [extra] })))).toContain('mine');
  });

  it('an added layer on ub-clusters gets the not-cluster filter, combined with its own', () => {
    const notCluster = ['!', ['has', 'clusterId']];
    const bare = { id: 'bare', type: 'circle', source: 'ub-clusters', paint: { 'circle-radius': 4 } };
    const own = ['==', ['get', 'art'], 'x'];
    const filtered = { ...bare, id: 'filtered', filter: own };
    const out = resolveLayers(viewWith({ layers: [bare, filtered] }));
    const get = (id: string) =>
      out.find((d) => (d.spec as { id: string }).id === id)?.spec as { filter?: unknown };
    expect(get('bare').filter).toEqual(notCluster);
    expect(get('filtered').filter).toEqual(['all', own, notCluster]);
  });

  it('an added layer on ub-geometry is untouched', () => {
    const shape = { id: 'zone', type: 'fill', source: 'ub-geometry', paint: { 'fill-color': '#f00' } };
    const out = resolveLayers(viewWith({ layers: [shape] }));
    expect(out.find((d) => (d.spec as { id: string }).id === 'zone')?.spec).toEqual(shape);
  });

  it('cluster circles and counts are drawn last when a view adds layers', () => {
    const extra = { id: 'mine', type: 'circle', source: 'ub-clusters', paint: { 'circle-radius': 3 } };
    const order = ids(resolveLayers(viewWith({ layers: [extra] })));
    expect(order.slice(-2)).toEqual(['ub-cluster', 'ub-cluster-count']);
  });

  it('a view-added layer draws below every look layer (WP-759, B-024)', () => {
    const extra = { id: 'mine', type: 'circle', source: 'ub-clusters', paint: { 'circle-radius': 3 } };
    const zone = { id: 'zone', type: 'fill', source: 'ub-geometry', paint: { 'fill-color': '#f00' } };
    const order = ids(resolveLayers(viewWith({ layers: [extra, zone] })));
    const first = Math.min(
      ...[LAYER_IDS.fill, LAYER_IDS.line, LAYER_IDS.single].map((i) => order.indexOf(i)),
    );
    expect(order.indexOf('mine')).toBeLessThan(first);
    expect(order.indexOf('zone')).toBeLessThan(first);
  });

  it('a replaced default keeps its own filter verbatim', () => {
    const own = ['==', ['get', 'count'], 1];
    const cluster = { id: 'ub-cluster', type: 'circle', source: 'ub-clusters', filter: own, paint: {} };
    const out = resolveLayers(viewWith({ layers: [cluster] }));
    expect(out.find((d) => (d.spec as { id: string }).id === 'ub-cluster')?.spec).toEqual(cluster);
  });

  it('a replaced default over ub-clusters keeps a legacy filter verbatim', () => {
    const legacy = ['==', 'art', 'x'];
    const cluster = { id: 'ub-cluster', type: 'circle', source: 'ub-clusters', filter: legacy, paint: {} };
    const out = resolveLayers(viewWith({ layers: [cluster] }));
    expect(out.find((d) => (d.spec as { id: string }).id === 'ub-cluster')?.spec).toEqual(cluster);
  });

  it('an invalid layer is a typed error carrying the layer id', () => {
    const bad = { id: 'broken', type: 'circle', source: 'ub-clusters', paint: { 'circle-radius': 'wide' } };
    try {
      resolveLayers(viewWith({ layers: [bad] }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(MapStyleError);
      expect((e as MapStyleError).layerId).toBe('broken');
    }
  });

  it('rejects sources the renderer does not define', () => {
    const other = { ...single, source: 'elsewhere' };
    expect(() => resolveLayers(viewWith({ layers: [other] }))).toThrow(MapStyleError);
  });

  it('rejects an unresolved $ref and a non-array layers list', () => {
    expect(() => resolveLayers(viewWith({ $ref: 'style.json' }))).toThrow(MapStyleError);
    expect(() => resolveLayers(viewWith({ layers: 'x' }))).toThrow(MapStyleError);
  });

  it('ignores styles of other renderers', () => {
    expect(resolveLayers(viewWith({ layers: 'x' }, 'cesium-3d'))).toBe(LAYERS);
  });
});

describe('pointPropertyKeys', () => {
  it('collects get/has keys from paint, layout and filter of point-source layers, not defaults', () => {
    const layer = {
      ...single,
      filter: ['all', ['has', 'art'], ['!', ['has', 'clusterId']]],
      paint: { ...single.paint, 'circle-radius': ['to-number', ['get', 'name']] },
    };
    const layers = resolveLayers(viewWith({ layers: [layer] }));
    expect(pointPropertyKeys(layers).sort()).toEqual(['$familyOpen', 'art', 'name', 'status']);
  });

  it('ignores geometry-source layers and reserved cluster keys', () => {
    const shape = { id: 'x', type: 'fill', source: 'ub-geometry', paint: { 'fill-color': ['get', 'zone'] } };
    expect(pointPropertyKeys(resolveLayers(viewWith({ layers: [shape] })))).toEqual(['$familyOpen']);
  });
});

describe('the default layers with no looks in the view (WP-747)', () => {
  it('paint the core fallback colour, the one the filter shows', () => {
    const paint = (id: string): Record<string, unknown> =>
      (LAYERS.find((d) => (d.spec as { id: string }).id === id)?.spec as { paint: Record<string, unknown> })
        .paint;
    expect(paint(LAYER_IDS.single)['circle-color']).toBe(DEFAULT_MARKER_COLOR);
    expect(paint(LAYER_IDS.fill)['fill-color']).toBe(DEFAULT_MARKER_COLOR);
    expect(paint(LAYER_IDS.line)['line-color']).toBe(DEFAULT_MARKER_COLOR);
  });
});
