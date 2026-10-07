// @vitest-environment jsdom
// v3's Werkzeuge sheet (ToolsSheet.svelte): a narrow right-hand sheet with a tile grid, an empty state, and the
// badge a tile may carry (v3: unread chat; no tool uses it yet).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import '@ueberblick/ui/testing';
import { axeViolations } from '@ueberblick/ui/testing';
import ToolsSheet from './ToolsSheet.svelte';

const tiles = [
  { key: 'search', label: 'Suche', icon: 'search' },
  { key: 'measure', label: 'Messen', icon: 'ruler' },
];

function open(over: Record<string, unknown> = {}) {
  const onopen = vi.fn();
  const view = render(ToolsSheet, { open: true, tiles, locale: 'de', onopen, ...over });
  return { onopen, ...view };
}

describe('ToolsSheet (v3 ToolsSheet)', () => {
  it('does not lock the rest of the shell: with the sheet open the page keeps taking taps (v3: the bar stays usable)', async () => {
    open();
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.style.pointerEvents).not.toBe('none');
  });
  it('is a right-hand sheet without an overlay, w-28 on a phone and w-32 from md, titled Werkzeuge', () => {
    open();
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('w-28');
    expect(dialog.className).toContain('md:w-32');
    expect(dialog.getAttribute('data-side') ?? dialog.className).toBeTruthy();
    expect(screen.getByText('Werkzeuge').className).toContain('text-sm');
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull();
  });

  it('shows one square tile per tool: an icon in a tinted circle and the label', () => {
    open();
    const search = screen.getByRole('button', { name: 'Suche' });
    expect(search.className).toContain('aspect-square');
    expect(search.className).toContain('rounded-lg');
    expect(search.querySelector('.bg-primary\\/10 svg')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Messen' })).toBeTruthy();
  });

  it('a tile closes the sheet and opens its tool', async () => {
    const { onopen, component } = open();
    void component;
    await fireEvent.click(screen.getByRole('button', { name: 'Messen' }));
    expect(onopen).toHaveBeenCalledWith('measure');
  });

  it('says so, in a dashed box, when no tool is on', () => {
    open({ tiles: [] });
    expect(screen.getByText('Keine Werkzeuge für dieses Projekt aktiv.').className).toContain(
      'border-dashed',
    );
    expect(screen.queryByRole('button', { name: 'Suche' })).toBeNull();
  });

  it('speaks English', () => {
    open({ tiles: [], locale: 'en' });
    expect(screen.getByText('No tools are active for this project.')).toBeTruthy();
    expect(screen.getByText('Tools')).toBeTruthy();
  });

  it('a tile with a count shows it as a badge, 99+ beyond 99; a soft mark is a dot only when the count is 0', () => {
    open({
      tiles: [
        { key: 'a', label: 'A', icon: 'search', badge: { hard: 120, soft: false } },
        { key: 'b', label: 'B', icon: 'search', badge: { hard: 3, soft: true } },
        { key: 'c', label: 'C', icon: 'search', badge: { hard: 0, soft: true } },
        { key: 'd', label: 'D', icon: 'search', badge: { hard: 0, soft: false } },
      ],
    });
    expect(screen.getByText('99+')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getAllByRole('img', { name: 'Ungelesen' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'D' }).querySelector('[data-slot="badge"]')).toBeNull();
  });

  it('has no accessibility violations', async () => {
    open();
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
