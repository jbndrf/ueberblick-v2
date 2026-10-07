// @vitest-environment jsdom
// WP-677 (B-019): what the shell does with the relation the feature sheet opens. Children that sit at their parent are
// not drawn separately: the relation fans them out above the parent (`createFamilyIsolate`); the others are isolated
// on the map as in WP-647. A moved parent moves the fan with nothing written.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeo, type Position } from '@ueberblick/core/geo';
import type { Edge, FeatureId, FeatureState, Key } from '@ueberblick/core/model';
import type { MapHandle, MarkerOptions } from '@ueberblick/ui';
import { createFamilyIsolate, ownAnchorOf } from './family';

afterEach(() => (document.body.innerHTML = ''));

const FILE = {
  types: {
    baum: {
      label: { de: 'Baum' },
      properties: { standort: { type: 'geometry', geometry_type: 'point' } },
      geometry: 'standort',
      relations: {
        massnahmen: { to: 'massnahme', inverse_of: 'massnahme.baum', inherit_position: true },
        kontrollen: { to: 'kontrolle', inverse_of: 'kontrolle.baum' },
      },
    },
    massnahme: {
      label: { de: 'Maßnahme' },
      properties: { baum: { type: 'reference', to: 'baum' }, was: { type: 'text' } },
      marker: { color: '#ff0000' },
    },
    kontrolle: {
      label: { de: 'Kontrolle' },
      properties: {
        baum: { type: 'reference', to: 'baum' },
        ort: { type: 'geometry', geometry_type: 'point' },
      },
      geometry: 'ort',
    },
  },
} as never;
const CONFIG = {
  file: FILE,
  foldTypes: new Map([
    ['baum', { primaryGeometry: 'standort' }],
    ['massnahme', {}],
    ['kontrolle', { primaryGeometry: 'ort' }],
  ]),
} as never;

const id = (s: string): FeatureId => s as FeatureId;
function world() {
  const states = new Map<string, FeatureState>();
  const edges: Edge[] = [];
  const point = (p: Position) => ({ type: 'Point', coordinates: p });
  const add = (f: string, type: string, props: Record<string, unknown>, lifecycle = 'active') =>
    states.set(f, {
      id: id(f),
      type: type as Key,
      properties: props as never,
      lifecycle,
      updatedSeq: 1,
    } as never);
  add('b1', 'baum', { standort: point([7, 50]) });
  const child = (n: string, type: string, parent: string) => {
    add(n, type, { baum: parent, was: n, ...(type === 'kontrolle' ? { ort: point([7.5, 50.5]) } : {}) });
    edges.push({ from: id(n), relation: 'baum' as Key, to: id(parent), derived: false });
  };
  const facts = {
    feature: vi.fn((f: FeatureId) => states.get(f)),
    edgesFrom: (f: FeatureId, relation?: Key) =>
      edges.filter((e) => e.from === f && (relation === undefined || e.relation === relation)),
  };
  return { states, facts, child, add, point };
}

function fakeMap() {
  const markers = new Map<string, { at: Position; el: HTMLElement }>();
  const moves = new Set<() => void>();
  const isolate = vi.fn();
  const handle = {
    project: ([x, y]: Position) => ({ x: x * 1000, y: -y * 1000 }),
    unproject: ({ x, y }: { x: number; y: number }): Position => [x / 1000, -y / 1000],
    addMarker: (m: string, at: Position, o: MarkerOptions) => {
      markers.set(m, { at, el: o.element });
      document.body.appendChild(o.element);
    },
    moveMarker: (m: string, at: Position) => {
      const x = markers.get(m);
      if (x) x.at = at;
    },
    removeMarker: (m: string) => {
      markers.get(m)?.el.remove();
      markers.delete(m);
    },
    onMove: (l: () => void) => (moves.add(l), () => moves.delete(l)),
    onMapTap: () => () => {},
    isolate,
  } as unknown as MapHandle;
  return { handle, markers, isolate };
}

function setup(w: ReturnType<typeof world>) {
  const m = fakeMap();
  const open = vi.fn();
  const listeners = new Set<() => void>();
  const family = createFamilyIsolate({
    config: CONFIG,
    facts: w.facts,
    geo: createGeo(),
    handle: () => m.handle,
    locale: 'de',
    openFeature: open,
    changed: { subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)) },
  });
  return { ...m, family, open, ring: () => listeners.forEach((l) => l()) };
}

describe('ownAnchorOf', () => {
  it('is the point of a point geometry, and undefined for a type with none', () => {
    const w = world();
    w.child('m1', 'massnahme', 'b1');
    const own = ownAnchorOf(CONFIG, w.facts, createGeo());
    expect(own(id('b1'))).toEqual([7, 50]);
    expect(own(id('m1'))).toBeUndefined();
  });
});

describe('opening a relation whose children sit at their parent', () => {
  it('fans them out above the parent; nothing is isolated on the map', () => {
    const w = world();
    for (const n of ['m1', 'm2', 'm3']) w.child(n, 'massnahme', 'b1');
    const s = setup(w);
    s.family.isolate([id('m1'), id('m2'), id('m3')]);
    expect(s.markers.size).toBe(3);
    for (const v of s.markers.values()) expect(v.at[0]).toBe(7); // straight above the parent
    expect([...s.markers.values()].every((v) => v.at[1] > 50)).toBe(true);
    expect(s.isolate).not.toHaveBeenCalledWith(expect.arrayContaining([id('m1')]));
  });
  it('names each child by its display name and opens it on a tap', () => {
    const w = world();
    w.child('m1', 'massnahme', 'b1');
    const s = setup(w);
    s.family.isolate([id('m1')]);
    document.querySelector<HTMLButtonElement>('button')?.click();
    expect(s.open).toHaveBeenCalledWith('m1');
  });
  it('cost follows the children of the opened parent: five markers and a chip for twelve children', () => {
    const w = world();
    const ids = Array.from({ length: 12 }, (_, i) => `m${i}`);
    for (const n of ids) w.child(n, 'massnahme', 'b1');
    for (let i = 0; i < 500; i++) w.add(`b${i + 10}`, 'baum', { standort: w.point([8, 51]) }); // other features
    const s = setup(w);
    w.facts.feature.mockClear();
    s.family.isolate(ids.map(id));
    expect(s.markers.size).toBe(6);
    expect(s.markers.get('family-fan-more')?.el.textContent).toContain('+7');
    expect(w.facts.feature.mock.calls.length).toBeLessThan(12 * 8); // a few reads per child, none per other feature
  });
  it('the chip opens the parent', () => {
    const w = world();
    const ids = Array.from({ length: 6 }, (_, i) => `m${i}`);
    for (const n of ids) w.child(n, 'massnahme', 'b1');
    const s = setup(w);
    s.family.isolate(ids.map(id));
    s.markers.get('family-fan-more')?.el.querySelector('button')?.click();
    expect(s.open).toHaveBeenCalledWith('b1');
  });
  it('a moved parent moves the fan, with no run: the geometry of the parent alone changes', () => {
    const w = world();
    w.child('m1', 'massnahme', 'b1');
    const s = setup(w);
    s.family.isolate([id('m1')]);
    expect(s.markers.get('family-fan-0')?.at[0]).toBe(7);
    w.states.set('b1', {
      ...(w.states.get('b1') as FeatureState),
      properties: { standort: w.point([9, 52]) },
    });
    s.ring();
    expect(s.markers.get('family-fan-0')?.at[0]).toBe(9);
    expect(s.markers.get('family-fan-0')?.at[1]).toBeGreaterThan(52);
  });
  it('null closes the fan and ends the isolation', () => {
    const w = world();
    w.child('m1', 'massnahme', 'b1');
    const s = setup(w);
    s.family.isolate([id('m1')]);
    s.family.isolate(null);
    expect(s.markers.size).toBe(0);
    expect(s.isolate).toHaveBeenLastCalledWith(null);
  });
  it('children with a position of their own are isolated on the map as before', () => {
    const w = world();
    w.child('k1', 'kontrolle', 'b1');
    const s = setup(w);
    s.family.isolate([id('k1')]);
    expect(s.markers.size).toBe(0);
    expect(s.isolate).toHaveBeenCalledWith([id('k1')]);
  });
  it('a finished child comes after an active one', () => {
    const w = world();
    w.child('m1', 'massnahme', 'b1');
    w.child('m2', 'massnahme', 'b1');
    w.states.set('m1', { ...(w.states.get('m1') as FeatureState), lifecycle: 'completed' });
    const s = setup(w);
    s.family.isolate([id('m1'), id('m2')]);
    const labels = [...s.markers.values()].map((v) =>
      v.el.querySelector('button')?.getAttribute('aria-label'),
    );
    expect(labels[0]).toContain('m2');
  });
});
