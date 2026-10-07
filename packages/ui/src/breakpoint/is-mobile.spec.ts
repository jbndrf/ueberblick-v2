// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { MOBILE_BELOW_PX, isMobileWidth } from './is-mobile';
import Probe from './testing/Probe.testing.svelte';

const resize = (width: number): void => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.dispatchEvent(new Event('resize'));
  flushSync();
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('breakpoint', () => {
  it('one edge: 767 px is a phone, 768 px is desktop (as the kit, the map and Tailwind md:)', () => {
    expect(MOBILE_BELOW_PX).toBe(768);
    expect(isMobileWidth(390)).toBe(true);
    expect(isMobileWidth(767)).toBe(true);
    expect(isMobileWidth(768)).toBe(false);
    expect(isMobileWidth(1280)).toBe(false);
  });

  it('reads the window and follows a resize', () => {
    resize(390);
    render(Probe);
    expect(screen.getByTestId('probe').textContent).toBe('phone');
    resize(1280);
    expect(screen.getByTestId('probe').textContent).toBe('desktop');
    resize(767);
    expect(screen.getByTestId('probe').textContent).toBe('phone');
  });

  it('shares one resize listener among all readers', () => {
    resize(390);
    const add = vi.spyOn(window, 'addEventListener');
    render(Probe);
    render(Probe);
    render(Probe);
    expect(add.mock.calls.filter((c) => c[0] === 'resize')).toHaveLength(1);
  });
});
