import { describe, expect, it } from 'vitest';
import { createGeo } from '@ueberblick/core/geo';
import type { Actor, FeatureId, FeatureState, Instant, Key } from '@ueberblick/core/model';
import { goldenConfig } from '@ueberblick/core/testing';
import { MemoryIndex } from '../../../../../../packages/client/src/store/memory';
import { createViewList } from '../view-source';

const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, '0')}` as FeatureId;
const tree = (
  n: number,
  geometry: unknown,
  lifecycle: FeatureState['lifecycle'] = 'active',
): FeatureState => ({
  id: id(n),
  type: 'baum' as Key,
  properties: { geometrie: geometry, stage: 'erfasst' } as never,
  lifecycle,
  updatedSeq: n + 1,
});
const point = (n: number) => ({ type: 'Point', coordinates: [7 + n / 10, 50 + n / 10] });

describe('Liste slices keep the rows (WP-818)', () => {
  const mem = new MemoryIndex();
  // mixed: inside/outside the extent, without a position, archived
  for (let i = 0; i < 20; i++) mem.putFeature(tree(i, i % 5 === 4 ? null : point(i)));
  mem.putFeature(tree(30, point(1), 'archived' as never));
  const deps = {
    facts: {
      feature: (f: FeatureId) => mem.feature(f),
      near: (t: Key, b: never) => mem.near(t, b),
      ofType: (t: Key) => mem.ofType(t),
      edgesFrom: (f: FeatureId) => mem.edgesFrom(f),
      edgesTo: (f: FeatureId) => mem.edgesTo(f),
      history: () => [],
    },
    config: goldenConfig('templates/baumkataster/1.0.0.yaml'),
    actor: { id: 'anna', kind: 'participant', roles: ['kontrolle' as Key] } as Actor,
    geo: createGeo(),
    now: () => '2026-09-30T10:00:00.000Z' as Instant,
    viewKey: 'alle_baeume',
    locales: ['de'],
  };
  const list = createViewList(deps);
  const extent = [7, 50, 8.2, 51.2] as [number, number, number, number];

  it.each([undefined, extent])('every slice size gives the same rows in the same order (extent %j)', (e) => {
    const full = list.rows(e);
    expect(full.length).toBeGreaterThan(0);
    for (const size of [1, 2, 3, 7, 1000]) {
      expect([...list.rowChunks(e, size)].flat()).toEqual(full);
    }
  });
  it('a feature without a position stays, a position outside the extent goes', () => {
    const ids = list.rows(extent).map((r) => r.id);
    expect(ids).toContain(id(4));
    expect(ids).not.toContain(id(13));
  });
});
