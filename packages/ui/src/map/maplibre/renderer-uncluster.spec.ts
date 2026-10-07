import { describe, expect, it } from 'vitest';
import { pointFeature } from '../test-helpers';
import type { UnclusterStats } from '../contract';
import { mount, styled, tick } from './renderer-fixture';

const many = Array.from({ length: 30 }, (_, i) => pointFeature(`p${i}`, 8 + i * 0.0002, 50));

async function opened(cap: number | null) {
  const m = mount(many, styled);
  await m.handle.ready;
  await tick();
  const seen: UnclusterStats[] = [];
  m.handle.onUnclusterStats?.((s) => seen.push(s));
  m.handle.setUncluster?.(cap);
  await tick();
  await tick();
  const last = m.calls.setData.at(-1);
  return { ...m, seen, drawn: last?.features ?? [] };
}

describe('maplibre-2d renderer: un-cluster (WP-666)', () => {
  it('clustered by default: no stats, groups drawn', async () => {
    const { seen, drawn } = await opened(null);
    expect(seen).toEqual([]);
    expect(drawn.some((f) => f.properties['clusterId'] !== undefined)).toBe(true);
  });

  it('within the cap every feature in view is drawn singly and the stats say so', async () => {
    const { seen, drawn } = await opened(30);
    expect(drawn).toHaveLength(30);
    expect(drawn.every((f) => f.properties['clusterId'] === undefined)).toBe(true);
    expect(seen.at(-1)).toEqual({ inView: 30, single: true });
  });

  it('above the cap the groups stay and the stats say "too many"', async () => {
    const { seen, drawn } = await opened(29);
    expect(drawn.some((f) => f.properties['clusterId'] !== undefined)).toBe(true);
    expect(seen.at(-1)).toEqual({ inView: 30, single: false });
  });

  it('turning it off again groups again and stops reporting', async () => {
    const m = await opened(30);
    m.handle.setUncluster?.(null);
    await tick();
    await tick();
    expect(m.calls.setData.at(-1)?.features.some((f) => f.properties['clusterId'] !== undefined)).toBe(true);
    const n = m.seen.length;
    await tick();
    expect(m.seen.length).toBe(n);
  });

  it('a listener added later gets the last stats at once', async () => {
    const m = await opened(30);
    const late: UnclusterStats[] = [];
    m.handle.onUnclusterStats?.((s) => late.push(s));
    expect(late).toEqual([{ inView: 30, single: true }]);
  });
});
