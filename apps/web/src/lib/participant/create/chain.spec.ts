// WP-677 (B-019, v3 `+page.svelte:2044-2149`): when does the + flow offer "Mit Eltern-Element verketten", and which
// features on the map are the candidates.
import { describe, expect, it } from 'vitest';
import { createGeo, type Bbox, type Position } from '@ueberblick/core/geo';
import type { FeatureId, FeatureState, Key } from '@ueberblick/core/model';
import { candidatesIn, chainOf, MAX_CANDIDATES } from './chain';

const FILE = {
  types: {
    gebiet: {
      label: { de: 'Gebiet' },
      properties: {
        name: { type: 'text', required: true },
        umriss: { type: 'geometry', geometry_type: 'polygon' },
      },
      geometry: 'umriss',
      relations: { baeume: { to: 'baum', inverse_of: 'baum.gebiet' } },
    },
    baum: {
      label: { de: 'Baum' },
      properties: {
        standort: { type: 'geometry', geometry_type: 'point' },
        gebiet: { type: 'reference', to: 'gebiet' },
        art: { type: 'reference', to: 'baumart' }, // a plain lookup: no parent declares it as a child list
      },
      geometry: 'standort',
      relations: {
        massnahmen: { to: 'massnahme', inverse_of: 'massnahme.baum', inherit_position: true },
        pflichtteile: { to: 'pflicht', inverse_of: 'pflicht.baum' },
      },
    },
    baumart: { label: { de: 'Baumart' }, properties: { name: { type: 'text' } } },
    massnahme: {
      label: { de: 'Maßnahme' },
      properties: { baum: { type: 'reference', to: 'baum', required: true } },
    },
    pflicht: {
      label: { de: 'Pflicht' },
      properties: {
        baum: { type: 'reference', to: 'baum', required: true },
        ort: { type: 'geometry', geometry_type: 'point' },
      },
      geometry: 'ort',
    },
  },
} as never;

describe('chainOf', () => {
  it('a type with an optional parent reference can be chained while it is placed', () => {
    expect(chainOf(FILE, 'baum')).toEqual({
      relations: [{ property: 'gebiet', parentType: 'gebiet' }],
      inherit: false,
    });
  });
  it('a plain lookup is no parent (the parent declares no child list for it)', () => {
    expect(chainOf(FILE, 'baum')?.relations.map((r) => r.property)).not.toContain('art');
  });
  it('a required parent reference is not offered as a chain (v3: only optional attachments)', () => {
    expect(chainOf(FILE, 'pflicht')).toBeUndefined();
  });
  it('a type that sits at its parent has no pin: the parent is its position, and picking it is not optional', () => {
    expect(chainOf(FILE, 'massnahme')).toEqual({
      relations: [{ property: 'baum', parentType: 'baum' }],
      inherit: true,
    });
  });
  it('a type with no parent, or no type, has no chain', () => {
    expect(chainOf(FILE, 'gebiet')).toBeUndefined();
    expect(chainOf(FILE, undefined)).toBeUndefined();
  });
});

describe('candidatesIn: the parents in view, nearest to the middle first', () => {
  const CONFIG = {
    file: FILE,
    foldTypes: new Map([
      ['gebiet', { primaryGeometry: 'umriss' }],
      ['baum', { primaryGeometry: 'standort' }],
    ]),
  } as never;
  const gebiet = (id: string, lon: number, lat: number, name: string): FeatureState =>
    ({
      id: id as FeatureId,
      type: 'gebiet' as Key,
      lifecycle: 'active',
      updatedSeq: 1,
      properties: {
        name,
        umriss: {
          type: 'Polygon',
          coordinates: [
            [
              [lon, lat],
              [lon + 0.001, lat],
              [lon + 0.001, lat + 0.001],
              [lon, lat],
            ],
          ],
        },
      },
    }) as never;
  const facts = (list: FeatureState[]) => ({
    feature: (id: FeatureId) => list.find((s) => s.id === id),
    near: (type: Key, box: Bbox) =>
      list.filter(
        (s) =>
          s.type === type &&
          (s.properties['umriss'] as { coordinates: number[][][] }).coordinates[0]?.[0]?.[0] !== undefined &&
          inBox(s, box),
      ),
  });
  const inBox = (s: FeatureState, b: Bbox): boolean => {
    const p = (s.properties['umriss'] as { coordinates: number[][][] }).coordinates[0]?.[0] as number[];
    return (
      (p[0] as number) >= b[0] &&
      (p[0] as number) <= b[2] &&
      (p[1] as number) >= b[1] &&
      (p[1] as number) <= b[3]
    );
  };
  const deps = (list: FeatureState[]) => ({
    config: CONFIG,
    facts: facts(list),
    geo: createGeo(),
    locale: 'de' as const,
  });
  const chain = chainOf(FILE, 'baum');
  const around: Position = [7, 50];
  const extent: Bbox = [6.9, 49.9, 7.1, 50.1];

  it('lists the parents inside the extent with their name and anchor, nearest first', () => {
    const list = [
      gebiet('g1', 7.05, 50.05, 'Nord'),
      gebiet('g2', 7.001, 50.001, 'Mitte'),
      gebiet('g3', 9, 52, 'Fern'),
    ];
    if (chain === undefined) throw new Error('no chain');
    const c = candidatesIn(deps(list), chain, extent, around);
    expect(c.map((x) => x.id)).toEqual(['g2', 'g1']);
    expect(c[0]?.label).toBe('Mitte');
    expect(c[0]?.relation).toEqual({ property: 'gebiet', parentType: 'gebiet' });
    expect(c[0]?.at[0]).toBeGreaterThan(7.001);
  });
  it('caps the rings, so a crowded view stays cheap', () => {
    const list = Array.from({ length: MAX_CANDIDATES + 50 }, (_, i) =>
      gebiet(`g${i}`, 7 + i * 0.0001, 50, `G${i}`),
    );
    if (chain === undefined) throw new Error('no chain');
    expect(candidatesIn(deps(list), chain, extent, around)).toHaveLength(MAX_CANDIDATES);
  });
  it('leaves out a parent that is not served (archived)', () => {
    const list = [{ ...gebiet('g1', 7.01, 50.01, 'Alt'), lifecycle: 'archived' } as FeatureState];
    if (chain === undefined) throw new Error('no chain');
    expect(candidatesIn(deps(list), chain, extent, around)).toEqual([]);
  });
});
