// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '../jsdom-shims.testing';
import Sample from './Sample.testing.svelte';

/** WP-320: v3's sidebar is in the kit with v3's markup (data-slot), and its texts can be set by the app. */
describe('the v3 sidebar in the kit', () => {
  it('renders v3 slots and classes', () => {
    const { baseElement } = render(Sample);
    for (const [slot, cls] of [
      ['sidebar', 'text-sidebar-foreground'],
      ['sidebar-header', 'flex'],
      ['sidebar-menu-button', 'rounded-md'],
      ['sidebar-group-label', 'text-xs'],
      ['sidebar-inset', 'bg-background'],
    ] as const) {
      const el = baseElement.querySelector(`[data-slot="${slot}"]`);
      expect(el, slot).not.toBeNull();
      expect(el?.getAttribute('class') ?? '', slot).toContain(cls);
    }
  });

  it('marks the active item', () => {
    render(Sample);
    expect(screen.getByRole('link', { name: 'Eins' }).getAttribute('data-active')).toBe('true');
  });

  it('the trigger takes its accessible name from the app, and toggles the sidebar state', async () => {
    const { baseElement } = render(Sample);
    const wrapper = (): string | null =>
      baseElement.querySelector('[data-slot="sidebar"]')?.getAttribute('data-state') ?? null;
    expect(wrapper()).toBe('expanded');
    await userEvent.click(screen.getByRole('button', { name: 'Seitenleiste umschalten' }));
    expect(wrapper()).toBe('collapsed');
  });
});

/** WP-461: a label wraps under WCAG 1.4.12 text spacing instead of being cut off. */
describe('menu button labels', () => {
  it('wrap rather than truncate, and the button grows (min-h, no overflow-hidden outside the collapsed icon rail)', () => {
    const { baseElement } = render(Sample);
    const cls = baseElement.querySelector('[data-slot="sidebar-menu-button"]')?.getAttribute('class') ?? '';
    expect(cls).toContain('break-words');
    expect(cls).not.toContain('truncate');
    expect(cls).toContain('min-h-8');
    expect(cls).not.toMatch(/(^|\s)overflow-hidden/);
  });
});
