import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createGeo } from '@ueberblick/core/geo';
import type { FeatureId, FeatureState, Key } from '@ueberblick/core/model';
import type { LifecycleState } from '@ueberblick/core/registry';
import { centreOf, readSearchSources, searchFeatures, type SearchPorts } from './model';

const geo = createGeo();
const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, '0')}` as FeatureId;

function feature(
  n: number,
  type: string,
  properties: FeatureState['properties'],
  lifecycle: LifecycleState = 'active',
): FeatureState {
  return { id: id(n), type: type as Key, properties, lifecycle, updatedSeq: n };
}

/** A brute-force stand-in for the store port: every word of the query prefixes a word of a source value. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
function fake(features: readonly FeatureState[]): SearchPorts {
  const byId = new Map(features.map((f) => [f.id, f]));
  return {
    feature: (i) => byId.get(i),
    searchText: (sources, query, limit) => {
      const words = fold(query).split(/\s+/).filter(Boolean);
      return features
        .filter((f) =>
          sources.some((s) => {
            if (s.type !== f.type) return false;
            const v = f.properties[s.property];
            const vw = typeof v === 'string' ? fold(v).split(/\s+/) : [];
            return words.every((w) => vw.some((x) => x.startsWith(w)));
          }),
        )
        .slice(0, limit)
        .map((f) => f.id);
    },
  };
}

describe('readSearchSources', () => {
  it('parses type.property entries', () => {
    expect(readSearchSources({ sources: ['baum.nummer', 'address.street'] })).toEqual([
      { type: 'baum', property: 'nummer' },
      { type: 'address', property: 'street' },
    ]);
  });
  it('no settings means no sources; a malformed entry is refused by name', () => {
    expect(readSearchSources({})).toEqual([]);
    expect(() => readSearchSources({ sources: ['address'] })).toThrow(/invalid search option/i);
    expect(() => readSearchSources({ sources: 'baum.nummer' })).toThrow(/invalid search option/i);
    expect(() => readSearchSources({ sources: ['a.b.c'] })).toThrow(/invalid search option/i);
  });
});

describe('searchFeatures', () => {
  const features = [
    feature(1, 'baum', { nummer: 'Bäume 12', art: 'Linde' }),
    feature(2, 'baum', { nummer: 'Eiche 7' }),
    feature(3, 'baum', { nummer: 'Bergahorn', art: 'Ahorn' }, 'deleted'),
    feature(4, 'address', { street: 'Baumstraße 3' }),
    feature(5, 'baum', { nummer: 42 }),
  ];
  const ports = fake(features);
  const sources = [
    { type: 'baum' as Key, property: 'nummer' },
    { type: 'address' as Key, property: 'street' },
  ];

  it('is prefix, case and diacritic insensitive, and labels a result by its first source value', () => {
    const r = searchFeatures(ports, sources, 'baume', 20);
    expect(r.map((x) => x.id)).toEqual([id(1)]);
    expect(r[0]).toMatchObject({ label: 'Bäume 12', type: 'baum' });
    expect(searchFeatures(ports, sources, 'BAUM', 20).map((x) => x.id)).toEqual([id(1), id(4)]);
  });

  it('skips deleted or unreadable features and nothing for an empty query or no sources', () => {
    expect(searchFeatures(ports, sources, 'berg', 20)).toEqual([]);
    expect(searchFeatures(ports, sources, '   ', 20)).toEqual([]);
    expect(searchFeatures(ports, [], 'baum', 20)).toEqual([]);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 50 }, (_, i) => feature(100 + i, 'baum', { nummer: `Baum ${i}` }));
    expect(searchFeatures(fake(many), sources, 'baum', 7)).toHaveLength(7);
  });

  it('falls back to the id when the value is not text', () => {
    const p = fake([feature(9, 'baum', { nummer: '' })]);
    expect(searchFeatures({ ...p, searchText: () => [id(9)] }, sources, 'x', 5)[0]?.label).toBe(id(9));
  });

  it('property: every result matches the brute-force filter for random prefixes', () => {
    const words = ['Linde', 'Ähre', 'Eiche', 'ulme', 'Übergang', 'ÉCOLE', 'baum'];
    const feats = Array.from({ length: 40 }, (_, i) =>
      feature(200 + i, 'baum', { nummer: `${words[i % words.length]} ${i}` }),
    );
    const p = fake(feats);
    fc.assert(
      fc.property(fc.stringMatching(/^[a-zA-ZäöüÄÖÜéÉ]{1,4}$/), (q) => {
        const got = searchFeatures(p, sources, q, 100).map((x) => x.id);
        expect(got).toEqual(p.searchText(sources, q, 100));
      }),
      { numRuns: 100 },
    );
  });
});

describe('centreOf', () => {
  it('is a point on the declared primary geometry, via core.geo', () => {
    const f = feature(1, 'baum', {
      nummer: 'x',
      lage: { type: 'Point', coordinates: [9.5, 48.5, 300] },
    });
    expect(centreOf(geo, f, 'lage' as Key)).toEqual([9.5, 48.5]);
    const poly = feature(2, 'baum', {
      zone: {
        type: 'Polygon',
        coordinates: [
          [
            [9, 48],
            [9.01, 48],
            [9.01, 48.01],
            [9, 48.01],
            [9, 48],
          ],
        ],
      },
    });
    const c = centreOf(geo, poly, 'zone' as Key);
    expect(c?.[0]).toBeGreaterThan(9);
    expect(c?.[0]).toBeLessThan(9.01);
  });
  it('is undefined without a primary geometry: no fallback to another geometry property', () => {
    const f = feature(3, 'baum', { lage: { type: 'Point', coordinates: [9.5, 48.5] } });
    expect(centreOf(geo, f, undefined)).toBeUndefined();
    expect(centreOf(geo, f, 'zone' as Key)).toBeUndefined();
    expect(centreOf(geo, feature(4, 'baum', { lage: 'x' }), 'lage' as Key)).toBeUndefined();
  });
});
