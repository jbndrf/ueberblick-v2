import { describe, expect, it } from 'vitest';
import { memoryShort, parseMeminfo, parsePsi, swapStarved } from './memory.mjs';

const f = (memAvailMb: number, swapUsedMb = 0) => ({
  memTotalMb: 62_776,
  memAvailMb,
  swapTotalMb: 1024,
  swapUsedMb,
});

describe('memoryShort', () => {
  it('46 GB of 62 GB available with 800 MB swap and no pressure is not short', () => {
    expect(memoryShort(f(46_462, 800), { some: 0 })).toBe(false);
    expect(swapStarved(f(46_462, 800), { some: 0 })).toBe(false);
  });
  it('10 GB of 62 GB available is short', () => {
    expect(memoryShort(f(10_000), { some: 0 })).toBe(true);
    expect(swapStarved(f(10_000, 800), { some: 0 })).toBe(true);
  });
  it('PSI some 5 is short', () => {
    expect(memoryShort(f(46_462), { some: 5 })).toBe(true);
  });
});

describe('parsers', () => {
  it('reads meminfo and PSI text', () => {
    const t = 'MemTotal: 4194304 kB\nMemAvailable: 2097152 kB\nSwapTotal: 1048576 kB\nSwapFree: 524288 kB\n';
    expect(parseMeminfo(t)).toEqual({
      memTotalMb: 4096,
      memAvailMb: 2048,
      swapTotalMb: 1024,
      swapUsedMb: 512,
    });
    expect(parsePsi('some avg10=0.00 avg60=3.20 avg300=0\nfull avg10=0 avg60=0.5 avg300=0')).toEqual({
      some: 3.2,
      full: 0.5,
    });
  });
});
