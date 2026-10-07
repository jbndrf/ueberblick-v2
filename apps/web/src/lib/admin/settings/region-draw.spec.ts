import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  boxRing,
  canFinish,
  clearDraft,
  drawn,
  finishPolygon,
  setMode,
  startDraft,
  tap,
} from './region-draw';

describe('rectangle: two taps', () => {
  it('the first tap sets a corner, the second makes the box whichever way it is tapped', () => {
    let d = tap(startDraft(), [7.14, 50.75]);
    expect(d.corner).toEqual([7.14, 50.75]);
    expect(d.region).toBeNull();
    d = tap(d, [7.08, 50.7]);
    expect(d.region).toEqual([7.08, 50.7, 7.14, 50.75]);
    expect(d.corner).toBeNull();
  });
  it('two taps on one spot are no region', () => {
    const d = tap(tap(startDraft(), [7, 50]), [7, 50]);
    expect(d.region).toBeNull();
    expect(d.corner).toBeNull();
  });
  it('shows the box that follows the pointer after the first corner', () => {
    const d = tap(startDraft(), [7, 50]);
    expect(drawn(d, [8, 51])).toEqual({ kind: 'box', bounds: [7, 50, 8, 51], final: false });
    expect(drawn(d, null)).toBeNull();
    expect(drawn(startDraft(), [8, 51])).toBeNull();
  });
});

describe('polygon: taps, then Fertig', () => {
  const poly = (...pts: [number, number][]) =>
    pts.reduce((d, p) => tap(d, p), setMode(startDraft(), 'polygon'));
  it('needs three vertices to finish, and the region is the box around them', () => {
    let d = poly([7, 50], [8, 51]);
    expect(canFinish(d)).toBe(false);
    expect(finishPolygon(d)).toBe(d);
    d = tap(d, [7.5, 49]);
    expect(canFinish(d)).toBe(true);
    d = finishPolygon(d);
    expect(d.region).toEqual([7, 49, 8, 51]);
    expect(d.vertices).toEqual([]);
  });
  it('shows the path so far and the pointer', () => {
    const d = poly([7, 50], [8, 51]);
    expect(drawn(d, [9, 52])).toEqual({
      kind: 'path',
      points: [
        [7, 50],
        [8, 51],
        [9, 52],
      ],
    });
  });
});

describe('mode and clear (v3 switchMode, Löschen)', () => {
  it('the mode cannot change once a region is drawn; clear gives the map back', () => {
    const done = tap(tap(startDraft(), [7, 50]), [8, 51]);
    expect(setMode(done, 'polygon')).toBe(done);
    const cleared = clearDraft(done);
    expect(cleared.region).toBeNull();
    expect(setMode(cleared, 'polygon').mode).toBe('polygon');
  });
  it('switching mode drops what was started', () => {
    const d = setMode(tap(startDraft(), [7, 50]), 'polygon');
    expect(d.corner).toBeNull();
  });
  it('an existing region starts as drawn and is shown final', () => {
    const d = startDraft([7, 50, 8, 51]);
    expect(drawn(d, null)).toEqual({ kind: 'box', bounds: [7, 50, 8, 51], final: true });
    expect(tap(d, [1, 1])).toBe(d);
  });
});

describe('boxRing', () => {
  it('is a closed ring of five positions (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -170, max: 170, noNaN: true }),
        fc.double({ min: -80, max: 80, noNaN: true }),
        (w, s) => {
          const ring = boxRing([w, s, w + 1, s + 1]);
          expect(ring).toHaveLength(5);
          expect(ring[0]).toEqual(ring[4]);
        },
      ),
    );
  });
});
