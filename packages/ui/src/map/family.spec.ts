// WP-677 (B-019): the anchor of a child that has no position of its own, and the order of the fan.
import { describe, expect, it } from 'vitest';
import type { Position } from '@ueberblick/core/geo';
import type { Edge, FeatureId, Key } from '@ueberblick/core/model';
import { inheritRelations } from '@ueberblick/core/schema';
import { createFamily, fanOf, type FamilyPorts } from './family';

const id = (s: string): FeatureId => s as FeatureId;
const key = (s: string): Key => s as Key;

const TYPES = {
  baum: {
    relations: { massnahmen: { to: 'massnahme', inverse_of: 'massnahme.baum', inherit_position: true } },
  },
  massnahme: {
    relations: { teile: { to: 'teil', inverse_of: 'teil.massnahme', inherit_position: true } },
  },
  teil: {},
  weg: { relations: { baeume: { to: 'baum', inverse_of: 'baum.weg' } } }, // no inherit flag
} as const;

/** A world: trees with a point, measures that point at a tree, parts that point at a measure. */
function world(own: Record<string, Position>, parent: Record<string, [string, string]>) {
  const types: Record<string, string> = {
    t1: 'baum',
    t2: 'baum',
    m1: 'massnahme',
    m2: 'massnahme',
    p1: 'teil',
    loop1: 'massnahme',
    loop2: 'massnahme',
  };
  const ports: FamilyPorts = {
    feature: (f) => (types[f] === undefined ? undefined : { type: key(types[f] as string) }),
    edgesFrom: (f, relation) =>
      parent[f] === undefined || (relation !== undefined && relation !== parent[f][0])
        ? []
        : ([
            { from: id(f), relation: key(parent[f][0]), to: id(parent[f][1]), derived: false },
          ] satisfies Edge[]),
    ownAnchor: (f) => own[f],
  };
  return { ports, own };
}

describe('familyAnchor: a child is drawn where its parent is', () => {
  it('a feature with a position of its own keeps it', () => {
    const w = world({ t1: [7, 50] }, {});
    expect(createFamily(inheritRelations(TYPES), w.ports).anchorOf(id('t1'))).toEqual([7, 50]);
  });
  it('an inheriting child takes the parent anchor through the edge', () => {
    const w = world({ t1: [7, 50] }, { m1: ['baum', 't1'] });
    const family = createFamily(inheritRelations(TYPES), w.ports);
    expect(family.inherits(key('massnahme'))).toBe(true);
    expect(family.anchorOf(id('m1'))).toEqual([7, 50]);
    expect(family.parentOf(id('m1'))).toBe('t1');
  });
  it('follows a moved parent without any write: the next lookup reads the new anchor', () => {
    const w = world({ t1: [7, 50] }, { m1: ['baum', 't1'] });
    const family = createFamily(inheritRelations(TYPES), w.ports);
    expect(family.anchorOf(id('m1'))).toEqual([7, 50]);
    w.own['t1'] = [8, 51]; // the parent's geometry changes; the child's state is untouched
    expect(family.anchorOf(id('m1'))).toEqual([8, 51]);
  });
  it('grandchildren come along: the anchor is resolved up the chain', () => {
    const w = world({ t1: [7, 50] }, { m1: ['baum', 't1'], p1: ['massnahme', 'm1'] });
    expect(createFamily(inheritRelations(TYPES), w.ports).anchorOf(id('p1'))).toEqual([7, 50]);
  });
  it('a child with no parent edge, or whose parent has no position, has no anchor (nothing is drawn)', () => {
    const w = world({}, { m1: ['baum', 't1'] });
    const family = createFamily(inheritRelations(TYPES), w.ports);
    expect(family.anchorOf(id('m1'))).toBeUndefined();
    expect(family.anchorOf(id('m2'))).toBeUndefined();
  });
  it('a cycle of bad data ends with no anchor instead of looping', () => {
    const w = world({}, { loop1: ['baum', 'loop2'], loop2: ['baum', 'loop1'] });
    expect(createFamily(inheritRelations(TYPES), w.ports).anchorOf(id('loop1'))).toBeUndefined();
  });
  it('a type that is not declared as inheriting does not inherit', () => {
    const w = world({ t1: [7, 50] }, { t2: ['weg', 't1'] });
    const family = createFamily(inheritRelations(TYPES), w.ports);
    expect(family.inherits(key('baum'))).toBe(false);
    expect(family.anchorOf(id('t2'))).toBeUndefined();
  });
});

describe('fanOf: v3 shows five, active first then newest, and a +N chip for the rest', () => {
  const c = (n: string, active: boolean, changedAt?: string) => ({
    id: id(n),
    active,
    ...(changedAt ? { changedAt } : {}),
  });
  it('orders active before finished, then the most recent first', () => {
    const r = fanOf([c('a', false, '2026-10-03'), c('b', true, '2026-10-01'), c('c', true, '2026-10-02')]);
    expect(r.fanned.map((f) => f.id)).toEqual(['c', 'b', 'a']);
    expect(r.overflow).toBe(0);
  });
  it('caps the fan at five and counts the rest', () => {
    const many = Array.from({ length: 12 }, (_, i) => c(`k${i}`, true, `2026-10-${String(10 + i)}`));
    const r = fanOf(many);
    expect(r.fanned).toHaveLength(5);
    expect(r.overflow).toBe(7);
    expect(r.fanned[0]?.id).toBe('k11');
  });
});
