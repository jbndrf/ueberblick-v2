import { describe, expect, it } from 'vitest';
import { pointFeature } from '../test-helpers';
import { mount, polygon, tapMap, tick, under } from './renderer-fixture';

describe('maplibre-2d renderer', () => {
  it('draws polygons and lines as geometry, points only as cluster output', async () => {
    const { handle, calls } = mount();
    await handle.ready;
    await tick();
    const geometry = calls.updateData.filter((u) => u.source === 'ub-geometry');
    expect(geometry).toHaveLength(1);
    expect(geometry[0]?.diff.add?.map((f) => f.id)).toEqual(['poly1']);
    // Anchors of all three features reach the cluster source (the polygon at its point-on-surface).
    const items = calls.setData.at(-1)?.features ?? [];
    const total = items.reduce(
      (n, i) => n + (typeof i.properties.count === 'number' ? i.properties.count : 1),
      0,
    );
    expect(total).toBe(3);
  });

  it('clusters in the worker: the main thread posts deltas and receives cluster output', async () => {
    const { handle, posted } = mount();
    await handle.ready;
    await tick();
    const apply = posted.find((m) => m.type === 'apply');
    expect(apply).toMatchObject({
      type: 'apply',
      add: [{ id: 'p1' }, { id: 'p2' }, { id: 'poly1', lng: 1.5, lat: 1 }],
    });
    expect(posted.some((m) => m.type === 'query')).toBe(true);
  });

  it('incremental: updating one feature sends one feature to the worker and one to the map', async () => {
    const { handle, calls, posted, source } = mount();
    await handle.ready;
    await tick();
    const applies = posted.filter((m) => m.type === 'apply').length;
    const diffs = calls.updateData.length;
    source.emit({
      update: [
        {
          ...polygon,
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [5, 0],
                [5, 5],
                [0, 0],
              ],
            ],
          },
        },
      ],
    });
    await tick();
    const newApplies = posted.filter((m) => m.type === 'apply');
    expect(newApplies).toHaveLength(applies + 1);
    const last = newApplies.at(-1);
    expect(last).toMatchObject({ add: [], update: [{ id: 'poly1' }], remove: [] });
    expect(calls.updateData).toHaveLength(diffs + 1);
    expect(calls.updateData.at(-1)?.diff).toMatchObject({ add: [], update: [{ id: 'poly1' }], remove: [] });
  });

  it('updating a point does not touch the geometry source', async () => {
    const { handle, calls, source } = mount();
    await handle.ready;
    await tick();
    const diffs = calls.updateData.length;
    source.emit({ update: [pointFeature('p1', 8.5, 50)] });
    await tick();
    expect(calls.updateData).toHaveLength(diffs);
  });

  it('featureTap fires from a single, a shape and not from a cluster', async () => {
    const { handle, calls } = mount();
    const taps: string[] = [];
    handle.onFeatureTap((id) => taps.push(id));
    await handle.ready;
    calls.rendered = [under('ub-single', { featureId: 'p1' })];
    tapMap(calls);
    calls.rendered = [under('ub-shape-fill', { id: 'poly1' })];
    tapMap(calls);
    calls.rendered = [under('ub-cluster', { clusterId: 999999, count: 4 })];
    tapMap(calls);
    expect(taps).toEqual(['p1', 'poly1']);
  });

  it('destroy removes the map and unsubscribes', async () => {
    const { handle, calls, source } = mount();
    await handle.ready;
    handle.destroy();
    expect(calls.removed).toBe(true);
    const n = source.delivered.length;
    source.emit({ remove: [] });
    expect(source.delivered.length).toBe(n + 1); // source still emits; nobody listens
  });
});
