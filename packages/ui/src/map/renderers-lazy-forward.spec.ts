// WP-740: the lazy handle forwards and replays every MapHandle method. `setSelected` was dropped, so the highlight
// never reached the real map; setUncluster, onUnclusterStats, setLooks and setZoomBounds were dropped the same way.
import { describe, expect, it, vi } from 'vitest';
import type { FeatureId } from '@ueberblick/core/model';
import type { MapHandle } from './contract';
import { testSource } from './test-helpers';
import { mount as mountInner } from './maplibre/renderer-fixture';

const log: string[] = [];
const mapTapListeners = new Set<(at: [number, number]) => void>();
const inner: Partial<MapHandle> = {
  ready: Promise.resolve(),
  onFeatureTap: () => () => undefined,
  onExtentChange: () => () => undefined,
  onMapTap: (l) => {
    mapTapListeners.add(l as never);
    return () => void mapTapListeners.delete(l as never);
  },
  centerOn: (t) => void log.push(`center:${JSON.stringify(t)}`),
  isolate: (ids) => void log.push(`isolate:${ids === null ? 'null' : ids.join(',')}`),
  onMarkerDrag: () => () => undefined,
  onMove: () => () => undefined,
  setDoubleClickZoom: () => undefined,
  setSelected: (s) => void log.push(`selected:${s?.id ?? 'none'}`),
  setUncluster: (c) => void log.push(`uncluster:${String(c)}`),
  setZoomBounds: (b) => void log.push(`zoom:${JSON.stringify(b)}`),
  setLooks: (l) => void log.push(`looks:${l === undefined ? 'none' : 'set'}`),
  onUnclusterStats: () => {
    log.push('stats');
    return () => void log.push('stats:off');
  },
  destroy: () => undefined,
};
vi.mock('./maplibre/renderer', () => ({ createMaplibreRenderer: () => ({ mount: () => inner }) }));
const { createRendererMap, getRenderer } = await import('./renderers');
const mount = (): MapHandle =>
  getRenderer(createRendererMap(), 'maplibre-2d').mount({} as HTMLElement, {} as never, testSource([]));

describe('the lazy MapHandle (WP-740)', () => {
  it('exposes every method of the real renderer handle', async () => {
    const real = mountInner();
    await real.handle.ready;
    const lazy = mount();
    const missing = Object.keys(real.handle).filter((k) => !(k in lazy));
    expect(missing).toEqual([]);
  });

  it('holds the selection made before MapLibre loads and replays the latest', async () => {
    log.length = 0;
    const h = mount();
    h.setSelected?.({ id: 'a' as FeatureId, color: '#111' });
    h.setSelected?.({ id: 'b' as FeatureId, color: '#111' });
    await h.ready;
    expect(log).toContain('selected:b');
    expect(log).not.toContain('selected:a');
  });

  it('forwards a selection and its clearing once loaded', async () => {
    const h = mount();
    await h.ready;
    log.length = 0;
    h.setSelected?.({ id: 'c' as FeatureId, color: '#111' });
    h.setSelected?.(null);
    expect(log).toEqual(['selected:c', 'selected:none']);
  });

  it('replays uncluster, zoom bounds, looks and the stats listener', async () => {
    log.length = 0;
    const h = mount();
    h.setUncluster?.(50);
    h.setZoomBounds?.({ min: 3 });
    h.setLooks?.({} as never);
    const off = h.onUnclusterStats?.(() => undefined);
    h.centerOn([1, 2]);
    await h.ready;
    expect(log).toEqual(['uncluster:50', 'stats', 'looks:set', 'zoom:{"min":3}', 'center:[1,2]']);
    off?.();
    expect(log).toContain('stats:off');
  });

  it('replays an isolate after the camera call that came before it', async () => {
    log.length = 0;
    const h = mount();
    h.centerOn([1, 2]);
    h.isolate?.(['a' as FeatureId]);
    await h.ready;
    expect(log.filter((e) => /^(center|isolate)/.test(e))).toEqual(['center:[1,2]', 'isolate:a']);
  });

  it('replays a centerOn after the isolate that came before it (last intent wins)', async () => {
    log.length = 0;
    const h = mount();
    h.isolate?.(['a' as FeatureId]);
    h.centerOn([1, 2]);
    await h.ready;
    expect(log.filter((e) => /^(center|isolate)/.test(e))).toEqual(['isolate:a', 'center:[1,2]']);
  });

  it('does not replay a stale isolate list after isolate(null)', async () => {
    log.length = 0;
    const h = mount();
    h.isolate?.(['a' as FeatureId]);
    h.isolate?.(null);
    await h.ready;
    expect(log.filter((e) => e.startsWith('isolate'))).toEqual([]);
  });

  it('removes a listener from the real handle when unsubscribed after load', async () => {
    const h = mount();
    const seen: number[] = [];
    const off = h.onMapTap((at) => void seen.push(at[0]));
    await h.ready;
    for (const l of mapTapListeners) l([1, 1]);
    off();
    for (const l of mapTapListeners) l([2, 2]);
    expect(seen).toEqual([1]);
  });
});
