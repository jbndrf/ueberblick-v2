// WP-688: one tap resolves to one target through one hit test (v3: point, then line, then area).
import { describe, expect, it } from 'vitest';
import type { Position } from '@ueberblick/core/geo';
import { HIT_PAD_PX, pickHit, type HitClass } from './tap';
import { mount, tapMap, tick, under } from './renderer-fixture';

async function ready() {
  const m = mount();
  const features: string[] = [];
  const empty: Position[] = [];
  m.handle.onFeatureTap((id) => features.push(id));
  m.handle.onMapTap((at) => empty.push(at));
  await m.handle.ready;
  await tick();
  return { ...m, features, empty };
}
const point = under('ub-single', { featureId: 'p1' });
const line = under('ub-shape-line', { id: 'l1' });
const area = under('ub-shape-fill', { id: 'poly1' });

describe('map tap priority (WP-688)', () => {
  it('a tap inside an area on a point selects the point, even when the area is topmost', async () => {
    const { calls, features, empty } = await ready();
    calls.rendered = [area, point];
    tapMap(calls);
    expect(features).toEqual(['p1']);
    expect(empty).toEqual([]);
  });

  it('a tap on a line inside an area selects the line', async () => {
    const { calls, features } = await ready();
    calls.rendered = [area, line];
    tapMap(calls);
    expect(features).toEqual(['l1']);
  });

  it('a tap on the bare area selects the area', async () => {
    const { calls, features } = await ready();
    calls.rendered = [area];
    tapMap(calls);
    expect(features).toEqual(['poly1']);
  });

  it('a tap on nothing is an empty-map tap', async () => {
    const { calls, features, empty } = await ready();
    tapMap(calls, 7, 51);
    expect(features).toEqual([]);
    expect(empty).toEqual([[7, 51]]);
  });

  it('the topmost hit wins within a class', async () => {
    const { calls, features } = await ready();
    calls.rendered = [under('ub-single', { featureId: 'top' }), under('ub-single', { featureId: 'below' })];
    tapMap(calls);
    expect(features).toEqual(['top']);
  });

  it('asks MapLibre once, with the v3 pad, over every feature layer', async () => {
    const { calls } = await ready();
    const before = calls.queries.length;
    tapMap(calls, 8, 50, { x: 100, y: 200 });
    expect(calls.queries).toHaveLength(before + 1);
    expect(calls.queries.at(-1)?.box).toEqual([
      [100 - HIT_PAD_PX, 200 - HIT_PAD_PX],
      [100 + HIT_PAD_PX, 200 + HIT_PAD_PX],
    ]);
    expect(calls.queries.at(-1)?.layers).toEqual(
      expect.arrayContaining(['ub-single', 'ub-cluster', 'ub-shape-line', 'ub-shape-fill']),
    );
  });

  it('a cluster counts as a point: it wins over an area under it', async () => {
    const { calls, features } = await ready();
    calls.rendered = [area, under('ub-cluster', { count: 4 })]; // no clusterId: nothing to drill into, no feature tap
    tapMap(calls);
    expect(features).toEqual([]);
  });

  // WP-698 (owner bug): "Baum bewegen" inside an area tapped the area. A tool that owns the tap (the pin, the
  // drawing; v3 `isEditingLocation`, `wasFeatureTap`) gets the position whatever is under it.
  it('while a tool captures taps, a tap on an area (or a point) is a map tap with its position', async () => {
    const { handle, calls, features, empty } = await ready();
    handle.captureTaps?.(true);
    calls.rendered = [area, point];
    tapMap(calls, 9, 52);
    expect(features).toEqual([]);
    expect(empty).toEqual([[9, 52]]);
    handle.captureTaps?.(false);
    tapMap(calls, 9, 52);
    expect(features).toEqual(['p1']);
  });

  it('pickHit ignores hits on layers that are not tappable', () => {
    const classes = new Map<string, HitClass>([['a', 'area']]);
    expect(pickHit([under('overlay', {}), under('a', { id: 'x' })], classes)?.properties).toEqual({
      id: 'x',
    });
    expect(pickHit([under('overlay', {})], classes)).toBeUndefined();
  });
});
