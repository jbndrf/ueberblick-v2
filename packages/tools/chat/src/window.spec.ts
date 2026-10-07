import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { offsetsOf, rowAt, windowOf } from './window';

describe('offsetsOf and rowAt', () => {
  it('prefix sums, and the row that holds a pixel', () => {
    const o = offsetsOf([10, 20, 30]);
    expect([...o]).toEqual([0, 10, 30, 60]);
    expect([rowAt(o, 0), rowAt(o, 9), rowAt(o, 10), rowAt(o, 59), rowAt(o, 500)]).toEqual([0, 0, 1, 2, 2]);
  });
  it('property: rowAt finds the row whose range holds y', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 200 }), { minLength: 1, maxLength: 200 }),
        fc.nat(40_000),
        (heights, y) => {
          const o = offsetsOf(heights);
          const i = rowAt(o, y);
          expect(o[i] as number).toBeLessThanOrEqual(Math.min(y, (o[o.length - 1] as number) - 1));
          if (y < (o[o.length - 1] as number)) expect(y).toBeLessThan(o[i + 1] as number);
        },
      ),
    );
  });
});

describe('windowOf', () => {
  it('draws the viewport plus overscan and pads the rest', () => {
    const o = offsetsOf(Array.from({ length: 10_000 }, () => 50));
    const w = windowOf(o, 25_000, 600, 4);
    expect(w.from).toBe(500 - 4);
    expect(w.to).toBe(512 + 1 + 4);
    expect(w.before).toBe(w.from * 50);
    expect(w.before + (w.to - w.from) * 50 + w.after).toBe(w.total);
    expect(w.to - w.from).toBeLessThan(40);
  });
  it('is empty for no rows and clamps at both ends', () => {
    expect(windowOf(offsetsOf([]), 0, 600)).toMatchObject({ from: 0, to: 0, total: 0 });
    const o = offsetsOf([50, 50, 50]);
    expect(windowOf(o, -100, 600, 0)).toMatchObject({ from: 0, to: 3 });
    expect(windowOf(o, 9999, 100, 1)).toMatchObject({ from: 1, to: 3, after: 0 });
  });
});
