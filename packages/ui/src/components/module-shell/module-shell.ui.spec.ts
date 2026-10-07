// @vitest-environment jsdom
// WP-641: v3's module shell, ported once. Gestures, slide animation, desktop panel, slots and states.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import userEvent from '@testing-library/user-event';
import '../ui/jsdom-shims.testing';
import Shell from './testing/ModuleShell.testing.svelte';
import { PREVIEW_MAX_PX, previewOffset } from './edge-swipe';

const width = (w: number): void => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  window.dispatchEvent(new Event('resize'));
  flushSync();
};
beforeEach(() => width(390));
afterEach(cleanup);

const sheet = (): HTMLElement => screen.getByTestId('module-shell');
const toggle = (): HTMLElement => screen.getByRole('button', { name: 'Größe ändern' });
const pointer = (target: EventTarget, type: string, x: number, y: number): void => {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
  flushSync();
};
const header = (): HTMLElement => toggle().parentElement as HTMLElement;
const drag = (dx: number, dy: number): void => {
  pointer(toggle(), 'pointerdown', 100, 400);
  pointer(window, 'pointermove', 100 + dx, 400 + dy);
  pointer(window, 'pointerup', 100 + dx, 400 + dy);
};
const touch = (target: HTMLElement, type: string, y: number, x = 100): void => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] });
  target.dispatchEvent(e);
  flushSync();
};
const swipe = (body: HTMLElement, from: number, to: number): void => {
  touch(body, 'touchstart', from);
  touch(body, 'touchmove', to);
  touch(body, 'touchend', to);
};
const body = (): HTMLElement => screen.getByTestId('body').parentElement as HTMLElement;
const scrollAt = (el: HTMLElement, top: number, client: number, height: number): void => {
  Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: top });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: client });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: height });
};

describe('phone: bottom sheet', () => {
  it('is portaled to the body, 35 vh at peek and 90 vh expanded, rounded top, 4x40 handle pill, 80 px filler', () => {
    render(Shell);
    expect(sheet().parentElement).toBe(document.body);
    expect(sheet().style.height).toBe('35vh');
    expect(sheet().className).toContain('rounded-t-xl');
    expect(sheet().getAttribute('data-state')).toBe('peek');
    expect(sheet().querySelector('.h-1.w-10')).not.toBeNull();
    expect((sheet().querySelector('[style*="top: 100%"]') as HTMLElement).style.height).toBe('80px');
  });

  it('takes the heights as props (the cluster detail uses 35 and 75)', async () => {
    render(Shell, { peekVh: 35, expandedVh: 75 });
    await userEvent.setup().click(toggle());
    expect(sheet().style.height).toBe('75vh');
  });

  it('a tap on the header toggles peek and expanded', async () => {
    render(Shell);
    const user = userEvent.setup();
    await user.click(toggle());
    expect(sheet().style.height).toBe('90vh');
    await user.click(toggle());
    expect(sheet().style.height).toBe('35vh');
  });

  it('header drag of more than 80 px: up expands, down collapses, and from peek closes', () => {
    const onclose = vi.fn();
    render(Shell, { onclose });
    drag(0, -60);
    expect(sheet().style.height).toBe('35vh');
    drag(0, -81);
    expect(sheet().style.height).toBe('90vh');
    drag(0, 60);
    expect(sheet().style.height).toBe('90vh');
    drag(0, 81);
    expect(sheet().style.height).toBe('35vh');
    expect(onclose).not.toHaveBeenCalled();
    drag(0, 81);
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('the sheet follows a downward drag, without the transition, and settles after', () => {
    render(Shell);
    pointer(toggle(), 'pointerdown', 100, 400);
    pointer(window, 'pointermove', 100, 450);
    expect(sheet().style.transform).toBe('translateY(50px)');
    expect(sheet().className).toContain('transition-none');
    pointer(window, 'pointerup', 100, 450);
    expect(sheet().style.transform).toBe('');
    expect(sheet().className).not.toContain('transition-none');
  });

  it('a drag does not also toggle through its click', async () => {
    render(Shell);
    drag(0, -90);
    toggle().click();
    flushSync();
    expect(sheet().style.height).toBe('90vh');
  });

  it('content edge swipe: 110 px at the bottom edge up expands, at the top edge down collapses or closes', () => {
    const onclose = vi.fn();
    render(Shell, { onclose });
    scrollAt(body(), 0, 300, 300); // short content: top and bottom edge at once
    swipe(body(), 500, 420);
    expect(sheet().style.height).toBe('35vh');
    swipe(body(), 500, 380);
    expect(sheet().style.height).toBe('90vh');
    swipe(body(), 300, 450);
    expect(sheet().style.height).toBe('35vh');
    swipe(body(), 300, 450);
    expect(onclose).toHaveBeenCalledOnce();
  });

  it("a swipe that scrolled the content is the content's own", () => {
    render(Shell);
    scrollAt(body(), 100, 300, 900);
    touch(body(), 'touchstart', 500);
    body().scrollTop = 140;
    touch(body(), 'touchmove', 380);
    touch(body(), 'touchend', 380);
    expect(sheet().style.height).toBe('35vh');
  });

  it('shows a preview offset of 40 % of the swipe, at most 66 px', () => {
    expect(previewOffset(100, true, false, false)).toBe(40);
    expect(previewOffset(400, true, false, false)).toBe(PREVIEW_MAX_PX);
    expect(previewOffset(-100, false, true, false)).toBe(-40);
    expect(previewOffset(-100, false, true, true)).toBe(0);
    render(Shell);
    scrollAt(body(), 0, 300, 300);
    touch(body(), 'touchstart', 500);
    touch(body(), 'touchmove', 550);
    expect(sheet().style.transform).toBe('translateY(20px)');
    expect(sheet().className).toContain('transition-none');
    touch(body(), 'touchend', 550);
    expect(sheet().style.transform).toBe('');
  });

  it('a horizontal header swipe calls onnext or onprevious, when they are passed', () => {
    const onnext = vi.fn();
    const onprevious = vi.fn();
    render(Shell, { onnext, onprevious });
    drag(-100, 5);
    expect(onnext).toHaveBeenCalledOnce();
    drag(100, 5);
    expect(onprevious).toHaveBeenCalledOnce();
    expect(sheet().style.height).toBe('35vh');
  });

  it('a horizontal swipe with no handler does nothing', () => {
    const onclose = vi.fn();
    render(Shell, { onclose });
    drag(-100, 5);
    expect(onclose).not.toHaveBeenCalled();
  });
});

describe('slide animation', () => {
  it('slides in (translate-y-full to 0, 300 ms ease-out) and slides out; it is not unmounted', async () => {
    const view = render(Shell, { open: false });
    expect(sheet().className).toContain('translate-y-full');
    expect(sheet().className).toContain('duration-300');
    expect(sheet().className).toContain('ease-out');
    await view.rerender({ open: true });
    await waitFor(() => expect(sheet().className).toContain('translate-y-0'));
    await view.rerender({ open: false });
    expect(sheet().className).toContain('translate-y-full');
    expect(sheet().hasAttribute('inert')).toBe(true);
    expect(sheet().getAttribute('aria-hidden')).toBe('true');
  });

  it('on desktop it slides from the right (translate-x-full to 0)', async () => {
    width(1280);
    const view = render(Shell, { open: false });
    expect(sheet().className).toContain('translate-x-full');
    await view.rerender({ open: true });
    await waitFor(() => expect(sheet().className).toContain('translate-x-0'));
  });
});

describe('desktop: 450 px panel', () => {
  beforeEach(() => width(1280));

  it('sits right under the 56 px header, always expanded, without handle, filler or height', () => {
    render(Shell);
    const c = sheet().className;
    for (const cls of ['top-14', 'right-0', 'h-[calc(100vh-56px)]', 'w-[450px]', 'border-l'])
      expect(c).toContain(cls);
    expect(sheet().getAttribute('data-state')).toBe('full');
    expect(sheet().style.height).toBe('');
    expect(sheet().querySelector('.h-1.w-10')).toBeNull();
  });

  it('has no toggle button and no drag', () => {
    render(Shell);
    expect(screen.queryByRole('button', { name: 'Größe ändern' })).toBeNull();
  });

  it('the breakpoint is 768: 767 px is a phone, 768 px the panel', () => {
    width(767);
    render(Shell);
    expect(sheet().getAttribute('data-state')).toBe('peek');
    width(768);
    expect(sheet().getAttribute('data-state')).toBe('full');
  });
});

describe('slots and states', () => {
  it('shows title, subtitle, badge on bg-primary, header actions, body and footer', () => {
    render(Shell, { badge: 'Prüfung' });
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Baum');
    expect(screen.getByTestId('module-shell-subtitle').textContent).toBe('Alte Eiche');
    expect(screen.getByTestId('module-shell-badge').textContent).toBe('Prüfung');
    expect(header().className).toContain('bg-primary');
    expect(screen.getByTestId('header-action')).not.toBeNull();
    expect(screen.getByTestId('body')).not.toBeNull();
    expect(screen.getByTestId('footer')).not.toBeNull();
  });

  it("loading shows a spinner and v3's text and hides body and footer", () => {
    render(Shell, { loading: true });
    expect(screen.getByText('Loading...')).not.toBeNull();
    expect(screen.queryByTestId('body')).toBeNull();
    expect(screen.queryByTestId('footer')).toBeNull();
  });

  it('an error shows "Fehler" and the message, and hides body and footer', () => {
    render(Shell, { error: 'Nicht gefunden' });
    expect(screen.getByText('Error')).not.toBeNull();
    expect(screen.getByText('Nicht gefunden')).not.toBeNull();
    expect(screen.queryByTestId('footer')).toBeNull();
  });

  it('without a body the empty state says "No content"; the footer stays', () => {
    render(Shell, { empty: true });
    expect(screen.getByText('No content')).not.toBeNull();
    expect(screen.getByTestId('footer')).not.toBeNull();
  });

  it('Escape and the close button close; there is no scrim and the dialog is not modal', async () => {
    const onclose = vi.fn();
    render(Shell, { onclose });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.keyboard('{Escape}');
    expect(onclose).toHaveBeenCalledTimes(2);
    expect(sheet().getAttribute('aria-modal')).toBeNull();
    expect(document.querySelector('[data-slot$="overlay"], .bg-black\\/50')).toBeNull();
  });

  it('Escape does nothing while closed', async () => {
    const onclose = vi.fn();
    render(Shell, { open: false, onclose });
    await userEvent.setup().keyboard('{Escape}');
    expect(onclose).not.toHaveBeenCalled();
  });
});

describe('Escape (WP-643)', () => {
  it('closes the shell, but not when it comes from a nested dialog', () => {
    const onclose = vi.fn();
    render(Shell, { open: true, onclose });
    const nested = document.createElement('div');
    nested.setAttribute('role', 'alertdialog');
    const inner = document.createElement('button');
    nested.append(inner);
    document.body.append(nested);
    inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onclose).not.toHaveBeenCalled();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onclose).toHaveBeenCalledTimes(1);
    nested.remove();
  });
});
