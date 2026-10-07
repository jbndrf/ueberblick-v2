import { describe, expect, it } from 'vitest';
import { createExtentHold, padExtent } from './extent';

describe('padExtent: a feature drawn on the edge of the view is in the Liste', () => {
  it('widens every side by a fraction of the span, so an anchor on the edge (or a rounding step off it) is inside', () => {
    const [w, s, e, n] = padExtent([10, 50, 12, 51]);
    expect(w).toBeLessThan(10);
    expect(s).toBeLessThan(50);
    expect(e).toBeGreaterThan(12);
    expect(n).toBeGreaterThan(51);
    expect(10 - w).toBeCloseTo(0.1, 5); // 5 % of the span of 2
  });
});

describe('createExtentHold: the extent the Liste reads', () => {
  it('follows the map while it is visible', () => {
    const hold = createExtentHold();
    expect(hold.read(() => [1, 2, 3, 4], false)).toEqual(padExtent([1, 2, 3, 4]));
    expect(hold.read(() => [2, 3, 4, 5], false)).toEqual(padExtent([2, 3, 4, 5]));
  });
  it('keeps the last visible extent while the map is hidden behind the Liste (a hidden map reports a point)', () => {
    const hold = createExtentHold();
    hold.read(() => [1, 2, 3, 4], false);
    expect(hold.read(() => [2, 3, 2, 3], true)).toEqual(padExtent([1, 2, 3, 4]));
  });
  it('ignores a collapsed extent even when the map is shown', () => {
    const hold = createExtentHold();
    hold.read(() => [1, 2, 3, 4], false);
    expect(hold.read(() => [5, 6, 5, 6], false)).toEqual(padExtent([1, 2, 3, 4]));
  });
  it('has no extent before the map is up: every feature is listed', () => {
    expect(createExtentHold().read(() => undefined, false)).toBeUndefined();
  });
});
