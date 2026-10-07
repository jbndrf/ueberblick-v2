// @vitest-environment jsdom
// v3's AdvancedFeaturesPanel: a collapsible box in Einstellungen -> Optionen with a count of what is on, an intro,
// and one switch per tool, grouped. In v4 the rows are the tools the role offers or has on.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import '@ueberblick/ui/testing';
import { axeViolations } from '@ueberblick/ui/testing';
import type { ToolEntry } from '../../../tools/entries';
import ToolSwitches from './ToolSwitches.svelte';

const entry = (key: string, availability: 'offered' | 'active', on: boolean): ToolEntry => ({
  key,
  contributes: ['tools-sheet'],
  icon: 'search',
  needsMap: false,
  readsMapTaps: false,
  availability,
  on,
});
const entries = [entry('measure', 'offered', false), entry('search', 'active', true)];

function mount(over: Record<string, unknown> = {}) {
  const onswitch = vi.fn();
  const view = render(ToolSwitches, { entries, locale: 'de', onswitch, ...over });
  return { onswitch, ...view };
}
const expand = () => fireEvent.click(screen.getByRole('button', { name: /Erweiterte Funktionen/ }));

describe('ToolSwitches (v3 AdvancedFeaturesPanel)', () => {
  it('is collapsed at first, with the title and a badge counting the tools that are on', () => {
    mount();
    const head = screen.getByRole('button', { name: /Erweiterte Funktionen/ });
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(head.textContent).toContain('1');
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('no badge while nothing is on', () => {
    mount({ entries: [entry('measure', 'offered', false)] });
    expect(screen.getByRole('button', { name: /Erweiterte Funktionen/ }).textContent).not.toMatch(/\d/);
  });

  it('expanded: the intro, the group, and per tool its name, description and a switch showing offered (off) or active (on)', async () => {
    mount();
    await expand();
    expect(screen.getByText(/Zusätzliche Werkzeuge einschalten/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Werkzeuge' })).toBeTruthy();
    expect(screen.getByText('Strecken und Flächen auf der Karte messen.')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Messen' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('switch', { name: 'Suche' }).getAttribute('aria-checked')).toBe('true');
  });

  it('a switch reports the new state of its tool', async () => {
    const { onswitch } = mount();
    await expand();
    await fireEvent.click(screen.getByRole('switch', { name: 'Messen' }));
    expect(onswitch).toHaveBeenCalledWith('measure', true);
    await fireEvent.click(screen.getByRole('switch', { name: 'Suche' }));
    expect(onswitch).toHaveBeenCalledWith('search', false);
  });

  it('groups by contribution point in v3 order and names them', async () => {
    mount({
      entries: [
        { ...entry('a', 'active', true), contributes: ['tools-sheet'] },
        { ...entry('b', 'active', true), contributes: ['filter-tab'] },
        { ...entry('c', 'active', true), contributes: ['layer-section'] },
      ],
      locale: 'en',
    });
    await fireEvent.click(screen.getByRole('button', { name: /Advanced features/ }));
    expect(screen.getAllByRole('heading').map((h) => h.textContent?.trim())).toEqual([
      'Filter sheet',
      'Layer sheet',
      'Map tools',
    ]);
  });

  it('shows nothing when the role has no tool to switch', () => {
    mount({ entries: [] });
    expect(screen.queryByRole('button', { name: /Erweiterte Funktionen/ })).toBeNull();
  });

  it('has no accessibility violations, collapsed and expanded', async () => {
    mount();
    // the box is a part of the Einstellungen sheet, which is the landmark: leave the page-level `region` rule out
    const violations = async () =>
      (await axeViolations(document.body)).filter((v) => !v.startsWith('region'));
    expect(await violations()).toEqual([]);
    await expand();
    expect(await violations()).toEqual([]);
  });
});
