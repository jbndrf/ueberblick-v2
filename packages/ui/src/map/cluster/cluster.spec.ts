import { describe, expect, it } from 'vitest';
import type { FeatureId } from '@ueberblick/core/model';
import { pointFeature } from '../test-helpers';
import { ClusterClient, createInProcessTransport } from './client';
import { ClusterIndex } from './index-core';
import type { ToWorker } from './protocol';

const WORLD = [-180, -90, 180, 90] as const;

describe('ClusterIndex', () => {
  it('clusters close points at low zoom and separates them at high zoom', () => {
    const index = new ClusterIndex();
    index.apply(
      [
        { id: 'a', lng: 10, lat: 50 },
        { id: 'b', lng: 10.0001, lat: 50.0001 },
        { id: 'c', lng: 20, lat: 40 },
      ],
      [],
      [],
    );
    const low = index.query(WORLD, 2);
    expect(low.filter((i) => i.count !== undefined)).toHaveLength(1);
    expect(low.find((i) => i.featureId === 'c')).toBeDefined();
    expect(index.query(WORLD, 22).every((i) => i.featureId !== undefined)).toBe(true);
  });

  it('applies updates and removals', () => {
    const index = new ClusterIndex();
    index.apply(
      [
        { id: 'a', lng: 1, lat: 1 },
        { id: 'b', lng: 5, lat: 5 },
      ],
      [],
      [],
    );
    index.apply([], [{ id: 'a', lng: 2, lat: 2 }], ['b']);
    const items = index.query(WORLD, 10);
    expect(items).toHaveLength(1);
    expect(items[0]?.featureId).toBe('a');
    expect(items[0]?.lng).toBeCloseTo(2, 6);
  });
});

describe('ClusterClient', () => {
  it('sends only the changed anchors; the answer is cluster output only', async () => {
    const posted: ToWorker[] = [];
    const inner = createInProcessTransport();
    const client = new ClusterClient({
      ...inner,
      post: (m) => {
        posted.push(m);
        inner.post(m);
      },
    });
    const many = Array.from({ length: 500 }, (_, i) => pointFeature(`f${i}`, i / 10, 40 + (i % 7)));
    client.apply({ add: many, update: [], remove: [] });
    client.apply({ add: [], update: [pointFeature('f3', 99, 10)], remove: [] });
    const applies = posted.filter((m) => m.type === 'apply');
    expect(applies[0]).toMatchObject({ add: { length: 500 } });
    expect(applies[1]).toMatchObject({ add: [], update: [{ id: 'f3', lng: 99, lat: 10 }], remove: [] });
    const items = await client.query([...WORLD], 1);
    expect(items.length).toBeLessThan(500);
    expect(items.some((i) => i.featureId === ('f3' as FeatureId))).toBe(true);
  });
});

describe('point properties', () => {
  it('returns properties only for the requested keys on single items', () => {
    const index = new ClusterIndex();
    index.apply([{ id: 'a', lng: 10, lat: 50, props: { vitalitaet: 3, art: 'Linde' } }], [], []);
    index.setKeys(['vitalitaet'], []);
    expect(index.query(WORLD, 22)[0]?.properties).toEqual({ vitalitaet: 3 });
  });

  it('setKeys with values fills existing points and dropping a key forgets it', () => {
    const index = new ClusterIndex();
    index.apply([{ id: 'a', lng: 10, lat: 50 }], [], []);
    index.setKeys(['art'], [{ id: 'a', props: { art: 'Linde' } }]);
    expect(index.query(WORLD, 22)[0]?.properties).toEqual({ art: 'Linde' });
    index.setKeys([], []);
    expect(index.query(WORLD, 22)[0]?.properties).toBeUndefined();
  });
});
