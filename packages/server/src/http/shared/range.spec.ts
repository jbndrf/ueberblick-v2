import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseByteRange } from './range';

describe('parseByteRange', () => {
  it('reads closed, open and suffix ranges', () => {
    expect(parseByteRange('bytes=0-99', 1000)).toEqual({ kind: 'partial', start: 0, end: 99 });
    expect(parseByteRange('bytes=900-', 1000)).toEqual({ kind: 'partial', start: 900, end: 999 });
    expect(parseByteRange('bytes=-100', 1000)).toEqual({ kind: 'partial', start: 900, end: 999 });
    expect(parseByteRange('bytes=-5000', 1000)).toEqual({ kind: 'partial', start: 0, end: 999 });
    expect(parseByteRange('bytes=990-5000', 1000)).toEqual({ kind: 'partial', start: 990, end: 999 });
  });
  it('is unsatisfiable past the end, for an empty suffix and for an empty file', () => {
    expect(parseByteRange('bytes=1000-', 1000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseByteRange('bytes=-0', 1000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseByteRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' });
  });
  it('ignores absent, malformed, foreign-unit and multiple ranges', () => {
    for (const h of [null, 'bytes=', 'bytes=-', 'bytes=5-2', 'items=0-1', 'bytes=0-1,4-5', 'bytes=a-b'])
      expect(parseByteRange(h, 1000)).toEqual({ kind: 'full' });
  });
  it('any partial result lies inside the file', () => {
    fc.assert(
      fc.property(fc.nat(5000), fc.nat(6000), fc.nat(6000), (size, a, b) => {
        for (const h of [`bytes=${a}-${b}`, `bytes=${a}-`, `bytes=-${b}`]) {
          const r = parseByteRange(h, size);
          if (r.kind === 'partial') {
            expect(r.start).toBeGreaterThanOrEqual(0);
            expect(r.start).toBeLessThanOrEqual(r.end);
            expect(r.end).toBeLessThan(size);
          }
        }
      }),
    );
  });
});
