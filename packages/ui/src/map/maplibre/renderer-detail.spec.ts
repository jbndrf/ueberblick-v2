// WP-653: a tap on a cluster reports its members (v3 opened the cluster detail sheet after 300 ms); a second tap
// within that time zooms to the members (v3 `MapCanvas.svelte:553-604`); `isolate` is v3's drill-down (draws only
// the chosen members, fits them, and puts the view back when it ends).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureId } from '@ueberblick/core/model';
import type { ClusterTap } from '../contract';
import { pointFeature } from '../test-helpers';
import { mount, tapMap, tick, under } from './renderer-fixture';

const FEATURES = [
  pointFeature('p1', 8, 50),
  pointFeature('p2', 8.0001, 50.0001),
  pointFeature('p3', 8.0002, 50.0002),
  pointFeature('far', 20, 40),
];
const ids = (...xs: string[]): FeatureId[] => xs as FeatureId[];

async function clusterTap(): Promise<ReturnType<typeof mount> & { tapCluster: () => void }> {
  const m = mount(FEATURES);
  await m.handle.ready;
  await tick();
  const items = m.calls.setData.at(-1)?.features ?? [];
  const cluster = items.find((i) => typeof i.properties.clusterId === 'number');
  expect(cluster).toBeDefined();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); // after the real ticks of the setup
  const tapCluster = (): void => {
    m.calls.rendered = [
      under('ub-cluster', cluster?.properties ?? {}, { type: 'Point', coordinates: [8, 50] }),
    ];
    tapMap(m.calls);
  };
  return { ...m, tapCluster };
}

describe('cluster tap (WP-653)', () => {
  afterEach(() => vi.useRealTimers());

  it('reports the members after 300 ms and does not zoom', async () => {
    const { handle, calls, tapCluster } = await clusterTap();
    const taps: ClusterTap[] = [];
    const fits = calls.fitted.length; // the first delivery fits the view once
    handle.onClusterTap?.((t) => taps.push(t));
    tapCluster();
    await vi.advanceTimersByTimeAsync(299);
    expect(taps).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(taps).toHaveLength(1);
    expect(taps[0]?.count).toBe(3);
    expect(taps[0]?.members.map((x) => x.id).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(taps[0]?.members[0]?.at).toHaveLength(2);
    expect(calls.eased).toHaveLength(0);
    expect(calls.fitted).toHaveLength(fits);
  });

  it('a second tap on the same cluster within 300 ms fits its members instead (max zoom 18)', async () => {
    const { handle, calls, tapCluster } = await clusterTap();
    const taps: ClusterTap[] = [];
    const fits = calls.fitted.length;
    handle.onClusterTap?.((t) => taps.push(t));
    tapCluster();
    await vi.advanceTimersByTimeAsync(100);
    tapCluster();
    await vi.advanceTimersByTimeAsync(1000);
    expect(taps).toHaveLength(0);
    expect(calls.fitted).toHaveLength(fits + 1);
    const { b, o } = calls.fitted[fits] as { b: number[][]; o: { maxZoom: number; padding: number } };
    expect(b[0]?.[0]).toBeCloseTo(8, 6);
    expect(b[1]?.[1]).toBeCloseTo(50.0002, 6);
    expect(o.maxZoom).toBe(18);
    expect(o.padding).toBe(40);
  });
});

describe('isolate (v3 drill-down, WP-653)', () => {
  afterEach(() => vi.useRealTimers());

  async function tapped() {
    const m = await clusterTap();
    m.handle.onClusterTap?.(() => undefined);
    m.tapCluster();
    await vi.advanceTimersByTimeAsync(400);
    return m;
  }
  type Data = { setData: { features: readonly { properties: Record<string, unknown> }[] }[] };
  const singles = (calls: Data) =>
    (calls.setData.at(-1)?.features ?? []).map((f) => f.properties.featureId).sort();

  it('draws only the chosen members, unclustered, and fits them with 60 px padding up to zoom 18', async () => {
    const { handle, calls } = await tapped();
    handle.isolate?.(ids('p1', 'p2'));
    await vi.advanceTimersByTimeAsync(0);
    expect(singles(calls)).toEqual(['p1', 'p2']);
    const { o } = calls.fitted.at(-1) as { o: { maxZoom: number; padding: number } };
    expect(o).toMatchObject({ maxZoom: 18, padding: 60 });
  });

  it('ending it draws the clusters again and flies back to the view it left; switching members keeps that view', async () => {
    const { handle, calls } = await tapped();
    handle.isolate?.(ids('p1'));
    handle.isolate?.(ids('p2', 'p3')); // another row: the saved view stays the first one
    await vi.advanceTimersByTimeAsync(0);
    expect(singles(calls)).toEqual(['p2', 'p3']);
    handle.isolate?.(null);
    await vi.advanceTimersByTimeAsync(0);
    const last = calls.setData.at(-1)?.features ?? [];
    expect(last.some((f) => typeof f.properties.clusterId === 'number')).toBe(true);
    expect(calls.eased.at(-1)).toMatchObject({ center: [0, 0], zoom: 3 });
    const flights = calls.eased.length;
    handle.isolate?.(null); // nothing to end: no second flight
    expect(calls.eased).toHaveLength(flights);
  });

  it('a moveend while isolated keeps drawing only the chosen members', async () => {
    const { handle, calls } = await tapped();
    handle.isolate?.(ids('p1'));
    await vi.advanceTimersByTimeAsync(0);
    calls.handlers.get('moveend')?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(singles(calls)).toEqual(['p1']);
  });
});

describe('isolate by id (WP-647, v3 onFocusRelation)', () => {
  it('draws features that are in no tapped cluster, fits them, and the end flies back', async () => {
    const m = mount(FEATURES);
    await m.handle.ready;
    await tick();
    m.handle.isolate?.(ids('far', 'p3', 'unknown'));
    await tick();
    const drawn = (m.calls.setData.at(-1)?.features ?? []).map((f) => f.properties.featureId).sort();
    expect(drawn).toEqual(['far', 'p3']);
    expect((m.calls.fitted.at(-1) as { o: object }).o).toMatchObject({ maxZoom: 18, padding: 60 });
    m.handle.isolate?.(null);
    await tick();
    expect(
      (m.calls.setData.at(-1)?.features ?? []).some((f) => typeof f.properties.clusterId === 'number'),
    ).toBe(true);
    expect(m.calls.eased.length).toBeGreaterThan(0);
  });

  it('ids the map does not hold change nothing; ending before the answer arrives draws nothing', async () => {
    const m = mount(FEATURES);
    await m.handle.ready;
    await tick();
    const draws = m.calls.setData.length;
    m.handle.isolate?.(ids('nope'));
    await tick();
    expect(m.calls.setData).toHaveLength(draws);
    m.handle.isolate?.(ids('far'));
    m.handle.isolate?.(null);
    await tick();
    expect((m.calls.setData.at(-1)?.features ?? []).map((f) => f.properties.featureId)).not.toEqual(['far']);
  });
});
