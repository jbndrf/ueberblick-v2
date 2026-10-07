import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { pointFeature } from '../test-helpers';
import { ClusterClient, createInProcessTransport } from './client';
import { ClusterIndex } from './index-core';
import type { ClusterItem, ClusterTransport } from './protocol';

const WORLD = [-180, -90, 180, 90] as const;
type Feature = ReturnType<typeof pointFeature>;

/** Reference: all values in one keys message, no chunking (the behaviour before WP-538). */
function unchunked(features: Feature[], keys: readonly string[]): ClusterItem[] {
  const index = new ClusterIndex();
  index.apply(
    features.map((f) => ({ id: f.id as string, lng: f.anchor[0] ?? 0, lat: f.anchor[1] ?? 0 })),
    [],
    [],
  );
  const values = features.map((f) => {
    const props: { [k: string]: never | string | number } = {};
    for (const k of keys) {
      const v = f.properties[k];
      if (typeof v === 'string' || typeof v === 'number') props[k] = v;
    }
    return { id: f.id as string, props };
  });
  index.setKeys(
    keys,
    values.filter((v) => Object.keys(v.props).length > 0),
  );
  return index.query(WORLD, 22);
}

const featureArb = fc.record({
  lng: fc.double({ min: 5, max: 15, noNaN: true }),
  lat: fc.double({ min: 47, max: 55, noNaN: true }),
  art: fc.option(fc.constantFrom('Linde', 'Eiche'), { nil: undefined }),
  v: fc.integer({ min: 0, max: 4 }),
});

/** Sorted by id; an empty `properties` counts as none (a feature updated without any used key). */
const byId = (l: readonly ClusterItem[]): ClusterItem[] =>
  l
    .map(({ properties, ...rest }) =>
      properties === undefined || Object.keys(properties).length === 0 ? rest : { ...rest, properties },
    )
    .sort((a, b) => (a.featureId ?? '').localeCompare(b.featureId ?? ''));

const tick = (): Promise<void> => Promise.resolve();

/** A transport that records the posted message types next to the in-process worker. */
function recording(): { transport: ClusterTransport; posts: string[] } {
  const inner = createInProcessTransport();
  const posts: string[] = [];
  return {
    posts,
    transport: {
      ...inner,
      post: (m) => {
        posts.push(m.type);
        inner.post(m);
      },
    },
  };
}

describe('ClusterClient.setKeys chunking', () => {
  it('property: any chunk size 1-7, missing props and later updates equal the unchunked delivery', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(featureArb, { maxLength: 30 }),
        fc.constantFrom(['v'], ['art'], ['v', 'art']),
        fc.integer({ min: 1, max: 7 }),
        fc.array(fc.tuple(fc.nat(29), featureArb), { maxLength: 6 }),
        async (rows, keys, size, updates) => {
          const make = (i: number, r: (typeof rows)[number]): Feature =>
            pointFeature(`f${i}`, r.lng, r.lat, r.art === undefined ? { v: r.v } : { v: r.v, art: r.art });
          const features = rows.map((r, i) => make(i, r));
          const changed = updates.filter(([i]) => i < rows.length).map(([i, r]) => make(i, r));
          const client = new ClusterClient(createInProcessTransport(), tick, size);
          client.apply({ add: features, update: [], remove: [] });
          client.setKeys(keys, features);
          client.apply({ add: [], update: changed, remove: [] });
          const final = new Map(features.map((f) => [f.id, f]));
          for (const f of changed) final.set(f.id, f);
          expect(byId(await client.query(WORLD, 22))).toEqual(byId(unchunked([...final.values()], keys)));
        },
      ),
      { numRuns: 60 },
    );
  });

  it('delivers in chunks with a yield each, all values arrive, a query waits for the last chunk', async () => {
    const size = 10;
    const n = size * 2 + 5;
    const features = Array.from({ length: n }, (_, i) =>
      pointFeature(`f${i}`, 10 + i / 1e5, 50, { art: i === n - 1 ? 'Eiche' : 'Linde' }),
    );
    const { transport, posts } = recording();
    let yields = 0;
    const client = new ClusterClient(
      transport,
      () => {
        yields++;
        return Promise.resolve();
      },
      size,
    );
    client.apply({ add: features, update: [], remove: [] });
    expect(client.setKeys(['art'], features)).toBe(true);
    const q = client.query(WORLD, 22);
    expect(posts).toEqual(['apply', 'keys']); // the first chunk goes out at once
    const items = await q;
    expect(posts).toEqual(['apply', 'keys', 'values', 'values', 'query']);
    expect(yields).toBe(2);
    expect(items).toHaveLength(n);
    expect(items.filter((i) => i.properties?.art === 'Linde')).toHaveLength(n - 1);
    expect(items.find((i) => i.featureId === `f${n - 1}`)?.properties).toEqual({ art: 'Eiche' });
  });

  it('snapshots the features at call time: a later mutation of the caller array is not delivered', async () => {
    const features = Array.from({ length: 6 }, (_, i) =>
      pointFeature(`f${i}`, 10 + i / 1e3, 50, { art: 'Linde' }),
    );
    const client = new ClusterClient(createInProcessTransport(), tick, 2);
    client.apply({ add: features, update: [], remove: [] });
    client.setKeys(['art'], features);
    features.length = 2; // mid-delivery
    features.push(pointFeature('x', 11, 50, { art: 'Eiche' }));
    const items = await client.query(WORLD, 22);
    expect(items).toHaveLength(6);
    expect(items.every((i) => i.properties?.art === 'Linde')).toBe(true);
  });

  it('a second setKeys during delivery keeps post order; only the new key remains, also back and forth', async () => {
    const features = Array.from({ length: 5 }, (_, i) =>
      pointFeature(`f${i}`, 10 + i / 1e3, 50, { art: 'Linde', v: i }),
    );
    const { transport, posts } = recording();
    const client = new ClusterClient(transport, tick, 2);
    client.apply({ add: features, update: [], remove: [] });
    client.setKeys(['art'], features);
    client.setKeys(['v'], features);
    const q = client.query(WORLD, 22);
    const items = await q;
    expect(posts).toEqual(['apply', 'keys', 'values', 'values', 'keys', 'values', 'values', 'query']);
    expect(items.every((i) => i.properties?.art === undefined && typeof i.properties?.v === 'number')).toBe(
      true,
    );

    client.setKeys(['art'], features);
    client.setKeys(['v'], features);
    client.setKeys(['art'], features);
    const back = await client.query(WORLD, 22);
    expect(back).toHaveLength(5);
    expect(back.every((i) => i.properties?.art === 'Linde' && i.properties.v === undefined)).toBe(true);
  });

  it('an apply made during delivery is applied after the values (call order kept)', async () => {
    const features = [pointFeature('a', 10, 50, { art: 'Linde' })];
    const client = new ClusterClient(createInProcessTransport(), tick);
    client.apply({ add: features, update: [], remove: [] });
    client.setKeys(['art'], features);
    client.apply({ add: [], update: [pointFeature('a', 10, 50, { art: 'Eiche' })], remove: [] });
    const items = await client.query(WORLD, 22);
    expect(items[0]?.properties).toEqual({ art: 'Eiche' });
  });
});
