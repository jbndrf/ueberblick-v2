// The tool ports of the maplibre-2d renderer: taps on empty map, centring, overlays (WP-576).
import { describe, expect, it } from 'vitest';
import type { FeatureId } from '@ueberblick/core/model';
import type { Position } from '@ueberblick/core/geo';
import { mount, styled, tick, under } from './renderer-fixture';

const line = {
  type: 'LineString',
  coordinates: [
    [7, 50],
    [8, 51],
  ],
} as const;
const style = { color: '#1b5e3b' };
const tap = (calls: ReturnType<typeof mount>['calls'], lng: number, lat: number): void =>
  calls.mapClick?.({ lngLat: { lng, lat }, point: { x: 10, y: 20 } });

async function ready(options = {}) {
  const m = mount(undefined, styled, options);
  await m.handle.ready;
  await tick();
  return m;
}

describe('onMapTap', () => {
  it('a tap on empty map fires with the WGS84 position and not onFeatureTap', async () => {
    const { handle, calls } = await ready();
    const taps: Position[] = [];
    const features: FeatureId[] = [];
    handle.onMapTap((at) => taps.push(at));
    handle.onFeatureTap((id) => features.push(id));
    tap(calls, 7.25, 50.5);
    expect(taps).toEqual([[7.25, 50.5]]);
    expect(features).toEqual([]);
  });

  it('a tap on a feature fires only onFeatureTap', async () => {
    const { handle, calls } = await ready();
    const taps: Position[] = [];
    const features: string[] = [];
    handle.onMapTap((at) => taps.push(at));
    handle.onFeatureTap((id) => features.push(id));
    calls.rendered = [under('ub-single', { featureId: 'p1' })];
    tap(calls, 8, 50);
    expect(taps).toEqual([]);
    expect(features).toEqual(['p1']);
  });

  it('a tap on a tool overlay still counts as a tap on empty map (Measure taps its own line)', async () => {
    const { handle, calls } = await ready();
    const taps: Position[] = [];
    handle.onMapTap((at) => taps.push(at));
    handle.showOverlay('m', line, style);
    calls.rendered = [under('ub-overlay-line', { id: 'm' })];
    tap(calls, 7.5, 50.5);
    expect(taps).toHaveLength(1);
  });

  it('unsubscribe stops delivery, and a redrawn view keeps tap detection', async () => {
    const { handle, calls } = await ready();
    const taps: Position[] = [];
    const off = handle.onMapTap((at) => taps.push(at));
    handle.setView(styled);
    tap(calls, 1, 2);
    off();
    tap(calls, 3, 4);
    expect(taps).toEqual([[1, 2]]);
  });
});

describe('centerOn', () => {
  it('centres on a point, keeping the zoom unless one is given, animated', async () => {
    const { handle, calls } = await ready({ reducedMotion: () => false });
    handle.centerOn([7, 50]);
    handle.centerOn([8, 51, 30], { zoom: 15 });
    expect(calls.eased.slice(-2)).toEqual([{ center: [7, 50] }, { center: [8, 51], zoom: 15 }]);
  });

  it('with a minimum zoom it zooms in to it and never out (v3 fly-to: max(current, 17))', async () => {
    const { handle, calls } = await ready({ reducedMotion: () => false });
    handle.centerOn([7, 50], { minZoom: 16 }); // the fixture map stands at zoom 3
    expect(calls.eased.at(-1)).toEqual({ center: [7, 50], zoom: 16 });
    handle.centerOn([7, 50], { minZoom: 2 });
    expect(calls.eased.at(-1)).toEqual({ center: [7, 50], zoom: 3 });
  });

  it('with an offset the point lands in the middle of what the sheets leave free (v3 flyToWithOffset)', async () => {
    const { handle, calls } = await ready({ reducedMotion: () => false });
    handle.centerOn([7, 50], { offset: { right: 450, bottom: 300 } });
    expect(calls.eased.at(-1)).toEqual({ center: [7, 50], offset: [-225, -150] });
    handle.centerOn([7, 50], { offset: { right: 224 } });
    expect(calls.eased.at(-1)).toEqual({ center: [7, 50], offset: [-112, -0] });
  });

  it('fits a bbox, animated', async () => {
    const { handle, calls } = await ready({ reducedMotion: () => false });
    handle.centerOn([7, 50, 8, 51]);
    expect(calls.fitted.slice(-1)).toEqual([
      {
        b: [
          [7, 50],
          [8, 51],
        ],
        o: expect.not.objectContaining({ duration: 0 }) as unknown,
      },
    ]);
  });

  it('jumps instead of animating when the user prefers reduced motion', async () => {
    const { handle, calls } = await ready({ reducedMotion: () => true });
    handle.centerOn([7, 50], { zoom: 12 });
    handle.centerOn([7, 50, 8, 51]);
    expect(calls.eased.at(-1)).toEqual({ center: [7, 50], zoom: 12, duration: 0 });
    expect(calls.fitted.at(-1)).toMatchObject({ o: { duration: 0 } });
  });

  it('a centring asked before the map is loaded is applied when it is', async () => {
    const m = mount(undefined, styled, { reducedMotion: () => false });
    m.handle.centerOn([9, 49]);
    await m.handle.ready;
    expect(m.calls.eased.at(-1)).toMatchObject({ center: [9, 49] });
  });
});

describe('overlays', () => {
  const data = (calls: ReturnType<typeof mount>['calls']) =>
    calls.setData.filter((s) => s.source === 'ub-overlay').at(-1)?.features ?? [];

  it('adds, replaces by id and clears, without touching the features in view', async () => {
    const { handle, calls, posted } = await ready();
    const applies = posted.filter((m) => m.type === 'apply').length;
    const diffs = calls.updateData.length;
    handle.showOverlay('measure', line, style);
    expect(data(calls)).toHaveLength(1);
    handle.showOverlay('measure', { type: 'Point', coordinates: [1, 2] }, { color: '#000', width: 6 });
    expect(data(calls)).toMatchObject([{ properties: { id: 'measure', color: '#000', width: 6 } }]);
    handle.showOverlay('hit', line, style);
    expect(data(calls)).toHaveLength(2);
    handle.clearOverlay('measure');
    expect(data(calls).map((f) => f.properties.id)).toEqual(['hit']);
    handle.clearOverlay('nothing');
    handle.clearOverlay('hit');
    expect(data(calls)).toEqual([]);
    expect(posted.filter((m) => m.type === 'apply')).toHaveLength(applies);
    expect(calls.updateData).toHaveLength(diffs);
  });

  it('uses the colours it is given, in data-driven paints (no colour of its own)', async () => {
    const { handle, calls } = await ready();
    handle.showOverlay('m', line, { color: '#123456', fillColor: '#abcdef' });
    const f = data(calls)[0];
    expect(f?.properties).toMatchObject({ color: '#123456', fillColor: '#abcdef' });
  });

  it('shown before the map loaded appears with the first draw', async () => {
    const m = mount(undefined, styled);
    m.handle.showOverlay('early', line, style);
    await m.handle.ready;
    expect(m.calls.sources.has('ub-overlay')).toBe(true);
    expect(data(m.calls)).toEqual([]); // the source was created with it (initial data), no later push needed
  });

  it('survives setView: back on top, not re-sent', async () => {
    const { handle, calls } = await ready();
    handle.showOverlay('m', line, style);
    const pushes = calls.setData.filter((s) => s.source === 'ub-overlay').length;
    handle.setView(styled);
    expect(calls.moved).toEqual([
      'ub-overlay-fill',
      'ub-overlay-accuracy',
      'ub-overlay-line',
      'ub-overlay-dash',
      'ub-overlay-point',
    ]);
    expect(calls.setData.filter((s) => s.source === 'ub-overlay')).toHaveLength(pushes);
    expect(calls.removedLayers.filter((l) => l.startsWith('ub-overlay'))).toEqual([]);
  });

  it('leaves no layer or source behind after destroy, and later calls are ignored', async () => {
    const { handle, calls } = await ready();
    handle.showOverlay('m', line, style);
    handle.destroy();
    expect(calls.removedLayers).toEqual(
      expect.arrayContaining([
        'ub-overlay-fill',
        'ub-overlay-accuracy',
        'ub-overlay-line',
        'ub-overlay-dash',
        'ub-overlay-point',
      ]),
    );
    expect(calls.sources.has('ub-overlay')).toBe(false);
    expect(() => {
      handle.showOverlay('x', line, style);
      handle.centerOn([1, 2]);
      handle.clearOverlay('x');
    }).not.toThrow();
  });
});
