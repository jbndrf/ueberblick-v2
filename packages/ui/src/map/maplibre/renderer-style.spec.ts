import { describe, expect, it } from 'vitest';
import type { View } from '@ueberblick/core/model';
import { pointFeature } from '../test-helpers';
import { counters, mount, styled, tapMap, tick, under } from './renderer-fixture';
import { MapStyleError } from './style';

describe('maplibre-2d renderer styles', () => {
  it('applies the view style over the default layers at mount', async () => {
    const { handle, calls } = mount(undefined, styled);
    await handle.ready;
    expect(calls.layers.filter((l) => !l.startsWith('ub-overlay'))).toEqual([
      'ub-shape-fill',
      'ub-shape-line',
      'ub-select-fill',
      'ub-select-line',
      'ub-select-halo',
      'ub-select-ring',
      'ub-single',
      'ub-family-open',
      'ub-family-open-count',
      'ub-cluster',
      'ub-cluster-count',
    ]);
    const single = calls.layerSpecs.find((s) => (s as { id: string }).id === 'ub-single') as {
      paint: Record<string, unknown>;
    };
    expect(single.paint['circle-color']).toEqual(['get', 'colour']);
  });

  it('draws single features and an added cluster layer on a fresh map, every source before any layer', async () => {
    const added = {
      layers: {
        m: {
          renderer: 'maplibre-2d',
          style: {
            layers: [
              { id: 'baum', type: 'circle', source: 'ub-clusters', paint: { 'circle-color': '#080' } },
              { id: 'ub-single', type: 'circle', source: 'ub-clusters', filter: ['!', ['has', 'clusterId']] },
            ],
          },
        },
      },
    } as unknown as View;
    const { handle, calls } = mount(undefined, added);
    await handle.ready; // the fake map throws on a layer whose source is missing
    expect(calls.layers).toEqual(expect.arrayContaining(['ub-single', 'baum', 'ub-cluster']));
    expect(calls.sources.has('ub-clusters')).toBe(true);
  });

  it('an invalid style rejects ready with the layer id', async () => {
    const bad = {
      layers: { m: { renderer: 'maplibre-2d', style: { layers: [{ id: 'oops', type: 'nope' }] } } },
    } as unknown as View;
    const { handle } = mount(undefined, bad);
    await expect(handle.ready).rejects.toBeInstanceOf(MapStyleError);
    await expect(handle.ready).rejects.toMatchObject({ layerId: 'oops' });
  });

  it('setView swaps the style without re-sending features', async () => {
    const { handle, calls, posted } = mount();
    await handle.ready;
    await tick();
    const applies = posted.filter((m) => m.type === 'apply').length;
    const diffs = calls.updateData.length;
    const layersBefore = calls.layers.length;
    handle.setView(styled);
    await tick();
    expect(calls.removedLayers).toHaveLength(11);
    expect(calls.layers.length).toBe(layersBefore + 11);
    expect(posted.filter((m) => m.type === 'apply')).toHaveLength(applies);
    expect(calls.updateData).toHaveLength(diffs);
  });

  it('setView with an invalid style throws and leaves the layers alone', async () => {
    const { handle, calls } = mount();
    await handle.ready;
    const bad = { layers: { m: { renderer: 'maplibre-2d', style: { layers: 3 } } } } as unknown as View;
    expect(() => handle.setView(bad)).toThrow(MapStyleError);
    expect(calls.removedLayers).toHaveLength(0);
  });

  const colourStyle = (key: string): View =>
    ({
      layers: {
        m: {
          renderer: 'maplibre-2d',
          style: {
            layers: [
              {
                id: 'ub-single',
                type: 'circle',
                source: 'ub-clusters',
                filter: ['!', ['has', 'clusterId']],
                paint: { 'circle-color': ['get', key] },
              },
            ],
          },
        },
      },
    }) as unknown as View;
  const trees = () => [
    pointFeature('t1', 8, 50, { vitalitaet: 3, art: 'Linde' }),
    pointFeature('t2', 20, 40, { vitalitaet: 1, art: 'Eiche' }),
  ];

  it('sends exactly the style-used properties to the worker and onto single points', async () => {
    const { handle, calls, posted } = mount(trees(), colourStyle('vitalitaet'));
    await handle.ready;
    await tick();
    const payload = JSON.stringify(posted);
    expect(payload).toContain('vitalitaet');
    expect(payload).not.toContain('Linde');
    expect(payload).not.toContain('"art"');
    const items = calls.setData.at(-1)?.features ?? [];
    const singles = items.filter((i) => typeof i.properties.featureId === 'string');
    expect(singles.map((i) => i.properties.vitalitaet).sort()).toEqual([1, 3]);
    expect(singles.every((i) => i.properties.art === undefined)).toBe(true);
  });

  it('without a style no properties are sent', async () => {
    const { handle, posted } = mount(trees());
    await handle.ready;
    await tick();
    expect(JSON.stringify(posted)).not.toContain('vitalitaet');
  });

  it('a style change needing a new key sends one keys message with only the new key', async () => {
    const { handle, calls, posted } = mount(trees(), colourStyle('vitalitaet'));
    await handle.ready;
    await tick();
    const before = posted.length;
    handle.setView(colourStyle('art'));
    await tick();
    const sent = posted.slice(before).filter((m) => m.type !== 'query');
    // the keys first, then the values in slices (WP-848)
    expect(sent.map((m) => m.type)).toEqual(['keys', 'values']);
    expect(sent[0]).toMatchObject({ type: 'keys', keys: ['art', '$familyOpen'] });
    const json = JSON.stringify(sent[1]);
    expect(json).toContain('Linde');
    expect(json).not.toContain('vitalitaet');
    expect(json).not.toContain('lng');
    const singles = (calls.setData.at(-1)?.features ?? []).filter(
      (i) => typeof i.properties.featureId === 'string',
    );
    expect(singles.map((i) => i.properties.art).sort()).toEqual(['Eiche', 'Linde']);
  });

  it('a style change with the same keys sends nothing to the worker but a query', async () => {
    const { handle, posted } = mount(trees(), colourStyle('vitalitaet'));
    await handle.ready;
    await tick();
    const before = posted.length;
    handle.setView(colourStyle('vitalitaet'));
    await tick();
    expect(posted.slice(before).filter((m) => m.type !== 'query')).toHaveLength(0);
  });

  it('a custom layer on a renderer source is tappable, also after setView', async () => {
    const custom = (id: string, source: string, type: string): View =>
      ({
        layers: {
          m: {
            renderer: 'maplibre-2d',
            style: { layers: [{ id, type, source, paint: type === 'circle' ? { 'circle-radius': 4 } : {} }] },
          },
        },
      }) as unknown as View;
    const { handle, calls } = mount(undefined, custom('mine', 'ub-clusters', 'circle'));
    const taps: string[] = [];
    handle.onFeatureTap((id) => taps.push(id));
    await handle.ready;
    calls.rendered = [under('mine', { featureId: 'p1' })];
    tapMap(calls);
    handle.setView(custom('other', 'ub-geometry', 'line'));
    tapMap(calls); // 'mine' is no longer a layer: nothing is asked for it, the tap is on empty map
    expect(calls.queries.at(-1)?.layers).toContain('other');
    expect(calls.queries.at(-1)?.layers).not.toContain('mine');
    calls.rendered = [under('other', { id: 'poly1' })];
    tapMap(calls);
    expect(taps).toEqual(['p1', 'poly1']);
  });

  it('setView while loading: the new view is drawn once, nothing stale', async () => {
    const { handle, calls } = mount();
    handle.setView(styled); // before `ready` resolved
    await handle.ready;
    await tick();
    expect(calls.layers.filter((l) => !l.startsWith('ub-overlay'))).toEqual([
      'ub-shape-fill',
      'ub-shape-line',
      'ub-select-fill',
      'ub-select-line',
      'ub-select-halo',
      'ub-select-ring',
      'ub-single',
      'ub-family-open',
      'ub-family-open-count',
      'ub-cluster',
      'ub-cluster-count',
    ]);
    expect(calls.removedLayers).toHaveLength(0);
    const single = calls.layerSpecs.find((s) => (s as { id: string }).id === 'ub-single') as {
      paint: Record<string, unknown>;
    };
    expect(single.paint['circle-color']).toEqual(['get', 'colour']);
  });

  it('a style error at mount closes the worker transport', async () => {
    counters.closed = 0;
    const bad = { layers: { m: { renderer: 'maplibre-2d', style: { layers: 3 } } } } as unknown as View;
    const { handle } = mount(undefined, bad);
    await expect(handle.ready).rejects.toBeInstanceOf(MapStyleError);
    expect(counters.closed).toBe(1);
  });
});
