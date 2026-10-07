// @vitest-environment jsdom
// WP-645: a row of Zuletzt flies with v3's offset (`+page.svelte:2420-2437`) and opens the detail while Zuletzt stays;
// beside an open detail the sheet shifts (`besideDetail`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import RecentSlot from './RecentSlot.svelte';
import type { ShellContext } from './sheets';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const state = { id: 'b1', type: 'baum', properties: { geometry: {} }, lifecycle: 'active', updatedSeq: 3 };

function ctxOf(over: Partial<ShellContext> = {}) {
  const centerOn = vi.fn();
  const openFeature = vi.fn();
  const ctx = {
    device: {
      store: { facts: { ofType: (t: string) => (t === 'baum' ? [state] : []) } },
      get classified() {
        return (this as unknown as { config: never }).config;
      },
      config: {
        file: { types: { baum: { label: { de: 'Baum' }, properties: {} } } },
        foldTypes: new Map([['baum', { primaryGeometry: 'geometry' }]]),
      },
      reader: {
        labelOf: () => 'Linde 1',
        warmActivity: () => Promise.resolve(),
        sheetInput: () => undefined,
      },
      clock: { now: () => '2026-10-01T12:00:00.000Z' },
      geo: { derive: () => ({ pointOnSurface: { coordinates: [7, 50] } }) },
      feature: () => state,
    },
    locale: 'de',
    filter: {
      activeView: () => null,
      state: () => ({ hiddenTypes: new Set(), hiddenValues: new Map() }),
      viewRevision: () => 0,
    },
    record: { current: () => ({ tools: {}, filters: { saved: [] } }) },
    map: { centerOn },
    openFeature,
    detailOpen: false,
    ...over,
  } as unknown as ShellContext;
  return { ctx, centerOn, openFeature };
}

const setWidth = (w: number, h: number): void => {
  vi.stubGlobal('innerWidth', w);
  vi.stubGlobal('innerHeight', h);
};

describe('the Zuletzt slot', () => {
  it('desktop: a row flies to 16 at least with right 450 + 256, and opens the detail', async () => {
    setWidth(1280, 800);
    const { ctx, centerOn, openFeature } = ctxOf();
    render(RecentSlot, { ctx, onclose: vi.fn() });
    await fireEvent.click(await screen.findByText('Linde 1'));
    expect(centerOn).toHaveBeenCalledWith([7, 50], { minZoom: 16, offset: { right: 706, bottom: 0 } });
    expect(openFeature).toHaveBeenCalledWith('b1');
  });

  it('phone: bottom is 0.35 of the height, right is the 224 px of Zuletzt', async () => {
    setWidth(390, 844);
    const { ctx, centerOn } = ctxOf();
    render(RecentSlot, { ctx, onclose: vi.fn() });
    await fireEvent.click(await screen.findByText('Linde 1'));
    expect(centerOn).toHaveBeenCalledWith([7, 50], { minZoom: 16, offset: { right: 224, bottom: 295 } });
  });

  it('beside an open detail it takes the shifted place (md:right-[450px])', async () => {
    setWidth(1280, 800);
    const { ctx } = ctxOf({ detailOpen: true });
    render(RecentSlot, { ctx, onclose: vi.fn() });
    expect((await screen.findByTestId('recent-sheet')).className).toContain('md:right-[450px]');
  });
});
