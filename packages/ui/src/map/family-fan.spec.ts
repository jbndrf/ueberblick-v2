// @vitest-environment jsdom
// WP-677 (B-019): the fan of the children at their parent (v3 `family-stack-fan.ts`): at most five icons and a "+N"
// chip above the parent, put on the map as markers, kept above the parent while the map moves, collapsed by a map tap.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Position } from '@ueberblick/core/geo';
import type { FeatureId } from '@ueberblick/core/model';
import type { MapHandle, MarkerOptions } from './contract';
import { createFamilyFan, type FanItem } from './family-fan';

afterEach(() => (document.body.innerHTML = ''));

/** A map where 1 degree is `view.scale` px (1000 at first): project and unproject are exact inverses. */
function fakeMap() {
  const view = { scale: 1000 };
  const markers = new Map<string, { at: Position; el: HTMLElement }>();
  const moves = new Set<() => void>();
  const taps = new Set<(at: Position) => void>();
  const handle = {
    project: ([x, y]: Position) => ({ x: x * view.scale, y: -y * view.scale }),
    unproject: ({ x, y }: { x: number; y: number }): Position => [x / view.scale, -y / view.scale],
    addMarker: (id: string, at: Position, o: MarkerOptions) => {
      markers.set(id, { at, el: o.element });
      document.body.appendChild(o.element);
    },
    moveMarker: (id: string, at: Position) => {
      const m = markers.get(id);
      if (m) m.at = at;
    },
    removeMarker: (id: string) => {
      markers.get(id)?.el.remove();
      markers.delete(id);
    },
    onMove: (l: () => void) => (moves.add(l), () => moves.delete(l)),
    onMapTap: (l: (at: Position) => void) => (taps.add(l), () => taps.delete(l)),
  } as unknown as MapHandle;
  return { handle, markers, moves, taps, view };
}

const item = (n: number): FanItem => ({
  id: `m${n}` as FeatureId,
  label: `Maßnahme ${n}`,
  icon: { url: 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E', width: 30, height: 30 },
});
const open = (m: ReturnType<typeof fakeMap>, count: number, overflow = 0) => {
  const onChild = vi.fn();
  const onOverflow = vi.fn();
  const fan = createFamilyFan(m.handle);
  fan.open({
    parent: 'p' as FeatureId,
    at: [7, 50],
    parentIconHeight: 34,
    items: Array.from({ length: count }, (_, i) => item(i)),
    overflow,
    overflowLabel: `${overflow} weitere`,
    onChild,
    onOverflow,
  });
  return { fan, onChild, onOverflow };
};

describe('the family fan', () => {
  it('puts one marker per child, stacked above the parent, with the chip last', () => {
    const m = fakeMap();
    open(m, 3, 4);
    expect([...m.markers.keys()]).toEqual([
      'family-fan-0',
      'family-fan-1',
      'family-fan-2',
      'family-fan-more',
    ]);
    const ys = [...m.markers.values()].map((v) => -v.at[1] * 1000);
    expect(ys[0]).toBeLessThan(-50 * 1000 + 1); // above the parent anchor (y grows down: smaller is higher)
    expect(ys[1]).toBeLessThan(ys[0] as number);
    expect(ys[2]).toBeLessThan(ys[1] as number);
    expect(m.markers.get('family-fan-more')?.el.textContent).toContain('+4');
  });
  it('a child is a button named by its label; a tap reports its id', () => {
    const m = fakeMap();
    const { onChild } = open(m, 2);
    const btn = document.querySelector<HTMLButtonElement>('button[aria-label="Maßnahme 1"]');
    expect(btn).not.toBeNull();
    btn?.click();
    expect(onChild).toHaveBeenCalledWith('m1');
  });
  it('the chip opens the parent (its relation list)', () => {
    const m = fakeMap();
    const { onOverflow } = open(m, 5, 3);
    document.querySelector<HTMLButtonElement>('button[aria-label="3 weitere"]')?.click();
    expect(onOverflow).toHaveBeenCalledWith('p');
  });
  it('every target is at least 44 px', () => {
    const m = fakeMap();
    open(m, 1, 2);
    for (const b of document.querySelectorAll<HTMLElement>('button')) {
      expect(parseInt(b.style.minWidth, 10)).toBeGreaterThanOrEqual(44);
      expect(parseInt(b.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
    }
  });
  it('stays a fixed number of pixels above the parent when the map zooms (re-projected, no markers added)', () => {
    const m = fakeMap();
    open(m, 2);
    const gap = (): number => (m.markers.get('family-fan-0')?.at[1] as number) - 50;
    const before = gap();
    m.view.scale = 2000; // zoomed in: the same pixels are half the degrees
    for (const l of m.moves) l();
    expect(m.markers.size).toBe(2);
    expect(gap()).toBeCloseTo(before / 2, 9);
  });
  it('a tap on the empty map collapses it', () => {
    const m = fakeMap();
    const { fan } = open(m, 3);
    expect(fan.isOpen()).toBe(true);
    for (const t of m.taps) t([0, 0]);
    expect(fan.isOpen()).toBe(false);
    expect(m.markers.size).toBe(0);
  });
  it('close removes everything; a second open replaces the first', () => {
    const m = fakeMap();
    const { fan } = open(m, 3);
    fan.open({
      parent: 'q' as FeatureId,
      at: [8, 51],
      parentIconHeight: 34,
      items: [item(9)],
      overflow: 0,
      overflowLabel: '',
      onChild: () => {},
      onOverflow: () => {},
    });
    expect(m.markers.size).toBe(1);
    expect(fan.openParent()).toBe('q');
    fan.close();
    expect(m.markers.size).toBe(0);
    expect(m.moves.size).toBe(0);
    expect(m.taps.size).toBe(0);
  });
});
