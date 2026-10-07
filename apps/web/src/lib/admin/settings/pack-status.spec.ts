import { describe, expect, it } from 'vitest';
import type { PackStatus } from '@ueberblick/server';
import { buildOf, isBuilding, sameDefinition } from './pack-status';
import type { PackRow } from './packs';

const ROW: PackRow = {
  key: 'innen',
  name: 'Innen',
  bounds: [7.08, 50.7, 7.14, 50.75],
  minZoom: 12,
  maxZoom: 14,
  layers: ['osm'],
  roles: ['kontrolle'],
};
const status = (over: Partial<PackStatus> = {}): PackStatus =>
  ({
    key: 'innen',
    label: 'Innen',
    bounds: [7.08, 50.7, 7.14, 50.75],
    min_zoom: 12,
    max_zoom: 14,
    roles: ['kontrolle'],
    hash: 'h',
    estimate: { tiles: 120, bytes: 1800000 },
    state: 'queued',
    progress: { tiles_done: 0, tiles_total: 120, bytes: 0 },
    bytes: 0,
    built_at: null,
    error: null,
    layers: [
      {
        layer: 'osm',
        state: 'queued',
        progress: { tiles_done: 0, tiles_total: 120, bytes: 0 },
        max_zoom: null,
        tiles: null,
        sha256: null,
        error: null,
        estimate: { tiles: 120, bytes: 1800000, max_zoom: 14 },
      },
    ],
    ...over,
  }) as PackStatus;

describe('what the table shows of a pack', () => {
  it('is a draft until a published pack with the same definition exists', () => {
    expect(buildOf(ROW, null).shown).toBe('draft');
    expect(buildOf(ROW, []).shown).toBe('draft');
    expect(buildOf(ROW, [status({ max_zoom: 15 })]).shown).toBe('draft'); // changed since it was built
    expect(buildOf(ROW, [status({ roles: null })]).shown).toBe('draft');
    expect(sameDefinition(ROW, status())).toBe(true);
  });
  it('queued and building show the estimate and the progress', () => {
    expect(buildOf(ROW, [status()])).toMatchObject({
      shown: 'queued',
      tiles: 120,
      approx: true,
      percent: null,
    });
    const building = status({ state: 'building', progress: { tiles_done: 30, tiles_total: 120, bytes: 10 } });
    expect(buildOf(ROW, [building])).toMatchObject({ shown: 'building', percent: 25 });
    expect(isBuilding([building])).toBe(true);
  });
  it('ready shows the real tile count and size', () => {
    const ready = status({
      state: 'ready',
      bytes: 345678,
      layers: status().layers.map((l) => ({ ...l, state: 'ready' as const, tiles: 99 })),
    });
    expect(buildOf(ROW, [ready])).toMatchObject({ shown: 'ready', tiles: 99, approx: false, bytes: 345678 });
    expect(isBuilding([ready])).toBe(false);
  });
  it('failed carries the reason', () => {
    const failed = status({ state: 'failed', error: 'tile host down' });
    expect(buildOf(ROW, [failed])).toMatchObject({ shown: 'failed', error: 'tile host down' });
    expect(isBuilding([failed])).toBe(false);
  });
});
