// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { carouselGestures, swipeDirection, SWIPE_MIN_PX } from './gestures';
import type { CarouselAPI } from '../../components/ui/carousel/context';

const fakeApi = () => {
  const api = {
    selectedScrollSnap: vi.fn(() => 0),
    scrollPrev: vi.fn(),
    scrollNext: vi.fn(),
    canScrollNext: vi.fn(() => true),
    canScrollPrev: vi.fn(() => true),
    reInit: vi.fn(),
  };
  return api as typeof api & CarouselAPI;
};
const touch = (el: HTMLElement, type: string, x: number, y: number) => {
  const t = { clientX: x, clientY: y } as Touch;
  const e = new Event(type, { bubbles: true });
  Object.assign(e, { touches: [t], changedTouches: [t] });
  el.dispatchEvent(e);
};

describe('swipeDirection (v3 handleSwipeEnd)', () => {
  it('goes next on a left swipe and prev on a right swipe beyond 30 px', () => {
    expect(swipeDirection({ x: 100, y: 0 }, { x: 50, y: 5 })).toBe('next');
    expect(swipeDirection({ x: 50, y: 0 }, { x: 100, y: 5 })).toBe('prev');
  });
  it('ignores short and mostly vertical moves', () => {
    expect(swipeDirection({ x: 0, y: 0 }, { x: SWIPE_MIN_PX, y: 0 })).toBeNull();
    expect(swipeDirection({ x: 0, y: 0 }, { x: 60, y: 80 })).toBeNull();
  });
  it('property: a direction needs |dx| > 30 and |dx| > |dy|', () => {
    fc.assert(
      fc.property(fc.integer({ min: -300, max: 300 }), fc.integer({ min: -300, max: 300 }), (dx, dy) => {
        const d = swipeDirection({ x: 0, y: 0 }, { x: dx, y: dy });
        const qualifies = Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy);
        expect(d !== null).toBe(qualifies);
        if (d) expect(d).toBe(dx > 0 ? 'prev' : 'next');
      }),
    );
  });
});

describe('carouselGestures', () => {
  it('a swipe scrolls when Embla did not already move', () => {
    const el = document.createElement('div');
    const api = fakeApi();
    const a = carouselGestures(el, api);
    touch(el, 'touchstart', 200, 0);
    touch(el, 'touchend', 100, 0);
    expect(api.scrollNext).toHaveBeenCalledOnce();
    // Embla moved on its own during the gesture: no second scroll.
    api.selectedScrollSnap.mockReturnValueOnce(0).mockReturnValue(1);
    touch(el, 'touchstart', 200, 0);
    touch(el, 'touchend', 100, 0);
    expect(api.scrollNext).toHaveBeenCalledOnce();
    a.destroy();
  });

  it('the wheel scrolls one slide, pauses 300 ms, and lets the page scroll at the ends', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    const api = fakeApi();
    const a = carouselGestures(el, api);
    const wheel = (deltaY: number) => {
      const e = new WheelEvent('wheel', { deltaY, cancelable: true });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(wheel(10)).toBe(true);
    expect(wheel(10)).toBe(true);
    expect(api.scrollNext).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(300);
    wheel(-10);
    expect(api.scrollPrev).toHaveBeenCalledOnce();
    api.canScrollNext.mockReturnValue(false);
    vi.advanceTimersByTime(300);
    expect(wheel(10)).toBe(false);
    a.destroy();
    vi.useRealTimers();
  });
});
