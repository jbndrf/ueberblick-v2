import { describe, expect, it } from 'vitest';
import { recentFly } from './fly';

describe('the fly-to of a Zuletzt row', () => {
  it('desktop: right 450, and 256 more while Zuletzt is open; no bottom offset', () => {
    expect(recentFly({ phone: false, innerHeight: 800, recentOpen: true })).toEqual({
      minZoom: 16,
      offset: { right: 706, bottom: 0 },
    });
    expect(recentFly({ phone: false, innerHeight: 800, recentOpen: false }).offset).toEqual({
      right: 450,
      bottom: 0,
    });
  });

  it('phone: bottom is 0.35 of the window height; right is 224 with Zuletzt open', () => {
    expect(recentFly({ phone: true, innerHeight: 844, recentOpen: true })).toEqual({
      minZoom: 16,
      offset: { right: 224, bottom: 295 },
    });
    expect(recentFly({ phone: true, innerHeight: 844, recentOpen: false }).offset).toEqual({
      right: 0,
      bottom: 295,
    });
  });
});
