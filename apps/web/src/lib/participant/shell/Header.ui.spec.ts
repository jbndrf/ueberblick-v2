// @vitest-environment jsdom
// The header (v3 `+layout.svelte:532-659`): the project's name and icon from the deployed branding (A-036). The
// icon is only ever an <img> (never inline SVG); without one the app's logo stands in (WP-645).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import axe from 'axe-core';
import Header from './Header.svelte';

const props = (over: Record<string, unknown> = {}) => ({
  locale: 'de' as const,
  title: 'Musterstadt Bäume',
  syncing: undefined,
  toolsActive: false,
  onbutton: () => undefined,
  ...over,
});
afterEach(cleanup);

describe.each([390, 1280])('Header at %i px', (width) => {
  it('shows the branding name and the icon as an <img>, with no violations', async () => {
    window.innerWidth = width;
    const { container } = render(Header, props({ icon: '/api/p/demo/blobs/ab12' }));
    expect(screen.getByText('Musterstadt Bäume')).toBeTruthy();
    const img = container.querySelector('header img');
    expect(img?.getAttribute('src')).toBe('/api/p/demo/blobs/ab12');
    expect(container.querySelector('header svg[data-branding], header img + svg')).toBeNull();
    const r = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  it('shows the app logo when the project has no icon', async () => {
    window.innerWidth = width;
    const { container } = render(Header, props());
    expect(container.querySelector('header img')?.getAttribute('src')).toBe('/icons/logo-light.png');
    const r = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});
