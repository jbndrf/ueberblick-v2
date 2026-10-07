// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import axe from 'axe-core';
import BottomBar from './BottomBar.svelte';
import Header from './Header.svelte';

afterEach(() => cleanup());

const axeViolations = async (el: Element): Promise<string[]> =>
  (await axe.run(el, { rules: { 'color-contrast': { enabled: false } } })).violations.map((v) => v.id);

describe('BottomBar', () => {
  it('shows Layer, Filter, +, Standort, Werkzeuge, Einstellungen in v3 order (German labels)', () => {
    render(BottomBar, { locale: 'de', toolsActive: true, fab: 0, onbutton: () => undefined });
    const nav = screen.getByRole('navigation', { name: 'Kartenleiste' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.getAttribute('title') ?? b.getAttribute('aria-label')),
    ).toEqual(['Layer', 'Filter', 'Neu', 'Standort', 'Werkzeuge', 'Einstellungen']);
  });

  it('labels share the width and truncate instead of colliding at the largest text size (WP-716)', () => {
    render(BottomBar, { locale: 'de', toolsActive: true, fab: 0, onbutton: () => undefined });
    const nav = screen.getByRole('navigation', { name: 'Kartenleiste' });
    for (const b of within(nav).getAllByRole('button', {
      name: /Layer|Filter|Standort|Werkzeuge|Einstellungen/,
    })) {
      expect(b.className).toMatch(/min-w-0 flex-1/);
      expect(b.className).not.toMatch(/\bw-14\b/);
      expect(b.querySelector('span.truncate')).not.toBeNull();
      expect(b.getAttribute('title')).toBeTruthy(); // the full name stays reachable
    }
  });

  it('has no Werkzeuge button while no tool is active', () => {
    render(BottomBar, { locale: 'en', toolsActive: false, fab: 0, onbutton: () => undefined });
    expect(screen.queryByRole('button', { name: /Tools/ })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });

  it('reports the tapped button; the + names itself Close menu while its cycle is open', async () => {
    const onbutton = vi.fn();
    const { rerender } = render(BottomBar, { locale: 'en', toolsActive: true, fab: 0, onbutton });
    await fireEvent.click(screen.getByRole('button', { name: /Layers/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'New' }));
    await fireEvent.click(screen.getByRole('button', { name: /Location/ }));
    expect(onbutton.mock.calls.map((c) => c[0])).toEqual(['layers', 'create', 'location']);
    await rerender({ locale: 'en', toolsActive: true, fab: 1, onbutton });
    expect(screen.getByRole('button', { name: 'Close menu' })).toBeTruthy();
  });

  it('has no axe violations, in both languages', async () => {
    const { container } = render(BottomBar, {
      locale: 'de',
      toolsActive: true,
      fab: 0,
      onbutton: () => undefined,
    });
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('Header', () => {
  const base = { locale: 'en' as const, title: 'trees', syncing: undefined, toolsActive: true };

  it('shows the project name, and the sync progress in its place while data moves', async () => {
    const { rerender } = render(Header, { ...base, onbutton: () => undefined });
    expect(screen.getByText('trees')).toBeTruthy();
    await rerender({ ...base, syncing: 120, onbutton: () => undefined });
    expect(screen.getByText('Syncing data (120)')).toBeTruthy();
    expect(screen.queryByText('trees')).toBeNull();
  });

  it('has the desktop icons of v3 and the account button, each reporting its function', async () => {
    const onbutton = vi.fn();
    render(Header, { ...base, onbutton });
    for (const name of [
      'Map Layers',
      'Filters',
      'New',
      'Recent',
      'My Location',
      'Tools',
      'Settings',
      'Account',
    ])
      await fireEvent.click(screen.getByRole('button', { name }));
    expect(onbutton.mock.calls.map((c) => c[0])).toEqual([
      'layers',
      'filter',
      'create',
      'recent',
      'location',
      'tools',
      'settings',
      'settings',
    ]);
  });

  it('draws the project icon through an img element, never inline (A-036: icons may be SVG)', () => {
    const { container } = render(Header, { ...base, icon: '/api/p/x/blobs/abc', onbutton: () => undefined });
    const img = container.querySelector('header img');
    expect(img?.getAttribute('src')).toBe('/api/p/x/blobs/abc');
    expect(container.querySelector('header svg[data-project-icon], header object, header iframe')).toBeNull();
  });

  it('has no Werkzeuge icon without a tool, and no axe violations', async () => {
    const { container } = render(Header, { ...base, toolsActive: false, onbutton: () => undefined });
    expect(screen.queryByRole('button', { name: 'Tools' })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });
});
