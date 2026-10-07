// @vitest-environment jsdom
// WP-645: Zuletzt beside an open detail (v3 `besideDetail`) and its remembered scroll position (`savedScrollTop`).
// WP-685: Zuletzt rows as v3 (RecentSheet.svelte:205-280): icon or colour dot, type, activity line, label, relative
// time and stage badge; at phone and desktop width, with axe.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { FeatureId, Instant, Key } from '@ueberblick/core/model';
import '@ueberblick/ui/testing';
import { axeViolations } from '@ueberblick/ui/testing';
import RecentSheet from './RecentSheet.svelte';
import type { RecentRow } from './recent';

afterEach(cleanup);
const NOW = '2026-10-01T12:00:00.000Z' as Instant;
const row = (extra: Partial<RecentRow>): RecentRow => ({
  id: 'a' as FeatureId,
  type: 'meldung' as Key,
  typeLabel: 'Meldung',
  label: 'Rohrbruch',
  hasLocation: true,
  look: { color: '#dc2626', size: 32 },
  ...extra,
});
const rows: RecentRow[] = [
  row({
    activity: '3 Felder aktualisiert',
    updatedAt: '2026-10-01T10:00:00.000Z' as Instant,
    stage: 'Prüfung',
  }),
  row({
    id: 'b' as FeatureId,
    type: 'einsatz' as Key,
    typeLabel: 'Einsatz',
    label: 'Kontrolle',
    hasLocation: false,
    look: { color: '#2b6cb0', size: 32, icon: { key: 'tree' } },
  }),
];
const mount = (r: readonly RecentRow[], locale: 'de' | 'en' = 'de', onopen = vi.fn()) =>
  render(RecentSheet, { open: true, rows: r, locale, now: NOW, onopen, onclose: vi.fn() });

describe('Zuletzt rows', () => {
  for (const width of [390, 1280]) {
    describe(`at ${width}px`, () => {
      const setWidth = () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
        window.dispatchEvent(new Event('resize'));
      };

      it('shows dot, type, activity line, label, relative time and stage badge', () => {
        setWidth();
        mount(rows);
        const first = screen.getAllByTestId('recent-row')[0] as HTMLElement;
        expect(within(first).getByTestId('recent-dot').getAttribute('style')).toContain('rgb(220, 38, 38)');
        expect(within(first).getByText('Meldung')).toBeTruthy();
        expect(within(first).getByTestId('recent-activity').textContent?.trim()).toBe(
          '3 Felder aktualisiert',
        );
        expect(within(first).getByText('Rohrbruch')).toBeTruthy();
        expect(within(first).getByTestId('recent-time').textContent).toBe('vor 2 Std');
        expect(within(first).getByTestId('recent-stage').textContent?.trim()).toBe('Prüfung');
      });

      it('draws the icon of a type that has one, and marks a row without location', () => {
        setWidth();
        mount(rows);
        const second = screen.getAllByTestId('recent-row')[1] as HTMLElement;
        expect(within(second).getByTestId('recent-icon')).toBeTruthy();
        expect(within(second).queryByTestId('recent-dot')).toBeNull();
        expect(within(second).queryByTestId('recent-activity')).toBeNull();
        expect(within(second).getByText('ohne Ort')).toBeTruthy();
      });

      it('has no axe violations', async () => {
        setWidth();
        const { baseElement } = mount(rows);
        const sheet = baseElement.querySelector('[data-testid="recent-sheet"]');
        expect(sheet).not.toBeNull();
        expect(await axeViolations(sheet as Element)).toEqual([]);
      });
    });
  }

  it('a row opens its Objekt', async () => {
    const onopen = vi.fn();
    mount(rows, 'de', onopen);
    await fireEvent.click(screen.getByText('Rohrbruch'));
    expect(onopen).toHaveBeenCalledWith('a');
  });

  it('says so when there is nothing yet, in English too', () => {
    mount([], 'en');
    expect(screen.getByText('No objects yet')).toBeTruthy();
  });
});

const longList: RecentRow[] = Array.from({ length: 30 }, (_, i) =>
  row({ id: `f${i}` as FeatureId, typeLabel: 'Baum', label: `Baum ${i}` }),
);

const props = (over: Record<string, unknown> = {}) => ({
  open: true,
  rows: longList,
  locale: 'de' as const,
  now: NOW,
  onopen: vi.fn(),
  onclose: vi.fn(),
  ...over,
});

describe('Zuletzt beside the detail', () => {
  it('sits at the right edge alone; beside an open detail it shifts left of the 450 px panel and above it on a desktop', () => {
    const { rerender } = render(RecentSheet, props());
    const sheet = () => screen.getByTestId('recent-sheet');
    expect(sheet().className).not.toContain('md:right-[450px]');
    void rerender(props({ besideDetail: true }));
    return waitFor(() => {
      expect(sheet().className).toContain('md:right-[450px]');
      expect(sheet().className).toContain('md:z-[1201]');
    });
  });
});

describe('the scroll position', () => {
  it('is kept while a row is picked and comes back when Zuletzt is opened again', async () => {
    const first = render(RecentSheet, props());
    const list = () => screen.getByTestId('recent-list');
    list().scrollTop = 240;
    await fireEvent.scroll(list());
    first.unmount();
    render(RecentSheet, props());
    await waitFor(() => expect(list().scrollTop).toBe(240));
  });
});
