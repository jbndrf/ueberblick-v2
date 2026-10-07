// @vitest-environment jsdom
// WP-645: the header and the bottom bar of v3 that the first port left out: logo fallback, app-loading message,
// the Werkzeuge badge (BottomControlBar:105, +layout:600) and the safe area below the bar.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import BottomBar from './BottomBar.svelte';
import Header from './Header.svelte';

afterEach(() => cleanup());

const noop = (): void => undefined;

describe('the Werkzeuge badge on the bar', () => {
  const bar = (badge: { hard: number; soft: boolean }) =>
    render(BottomBar, { locale: 'de', toolsActive: true, fab: 0, badge, onbutton: noop });

  it('a hard count sits on the button and says 99+ above 99', () => {
    const { unmount } = bar({ hard: 3, soft: true });
    expect(within(screen.getByRole('button', { name: /Werkzeuge/ })).getByText('3')).toBeTruthy();
    unmount();
    bar({ hard: 120, soft: false });
    expect(screen.getByText('99+')).toBeTruthy();
  });

  it('a soft dot shows without a count, and nothing shows without either', () => {
    const { unmount } = bar({ hard: 0, soft: true });
    expect(screen.getByText('Ungelesen')).toBeTruthy();
    unmount();
    bar({ hard: 0, soft: false });
    expect(screen.queryByText('Ungelesen')).toBeNull();
  });

  it('sits flush at the bottom (v3 has no padding); only iOS keeps the home-indicator inset', () => {
    bar({ hard: 0, soft: false });
    const tokens = screen.getByRole('navigation', { name: 'Kartenleiste' }).className.split(/\s+/);
    // Android Chrome reports an inset for a navigation bar the system draws itself: an unconditional inset was a band.
    expect(tokens).not.toContain('pb-[env(safe-area-inset-bottom)]');
    expect(tokens).toContain('supports-[-webkit-touch-callout:none]:pb-[env(safe-area-inset-bottom)]');
  });
});

describe('the header', () => {
  const base = { locale: 'en' as const, title: 'trees', syncing: undefined, toolsActive: true };

  it('shows the logo when the project has no icon, inverted in the dark theme', () => {
    const { container } = render(Header, { ...base, onbutton: noop });
    const img = container.querySelector('header img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/icons/logo-light.png');
    expect(img.className).toContain('dark:invert');
  });

  it('shows the project icon, not inverted, when the project has one', () => {
    const { container } = render(Header, { ...base, icon: '/api/p/x/blobs/abc', onbutton: noop });
    const img = container.querySelector('header img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/p/x/blobs/abc');
    expect(img.className).not.toContain('dark:invert');
  });

  it('shows the app-loading message, pulsing, in place of the name; the sync text goes before it', async () => {
    const { rerender } = render(Header, { ...base, loading: 'Loading objects ...', onbutton: noop });
    expect(screen.getByText('Loading objects ...').className).toContain('animate-pulse');
    expect(screen.getByText('Loading objects ...').className).toContain('motion-reduce:animate-none'); // WP-701
    expect(screen.queryByText('trees')).toBeNull();
    await rerender({ ...base, loading: 'Loading objects ...', syncing: 5, onbutton: noop });
    expect(screen.queryByText('Loading objects ...')).toBeNull();
    expect(screen.getByText('Syncing data (5)').className).toContain('animate-pulse');
    expect(screen.getByText('Syncing data (5)').className).toContain('motion-reduce:animate-none');
  });

  it('the Werkzeuge icon carries the badge: hard count, 99+, or a soft dot', async () => {
    const { rerender } = render(Header, { ...base, badge: { hard: 4, soft: false }, onbutton: noop });
    expect(within(screen.getByRole('button', { name: 'Tools' })).getByText('4')).toBeTruthy();
    await rerender({ ...base, badge: { hard: 200, soft: false }, onbutton: noop });
    expect(screen.getByText('99+')).toBeTruthy();
    await rerender({ ...base, badge: { hard: 0, soft: true }, onbutton: noop });
    expect(screen.getByText('Unread')).toBeTruthy();
  });
});
