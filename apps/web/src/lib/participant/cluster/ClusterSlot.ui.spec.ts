// @vitest-environment jsdom
// v3's cluster detail as a journey: the tap shows the composition in the shared shell (peek 35 vh, expanded 75 vh), a
// row is the drill-down (the map shows only its members), the same row again or closing the sheet ends it, a tap on
// empty map closes the sheet.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import axe from 'axe-core';
import type { ClusterTap } from '@ueberblick/ui';
import type { FeatureState, Key } from '@ueberblick/core/model';
import { goldenConfig } from '@ueberblick/core/testing';
import ClusterSlot from './ClusterSlot.svelte';
import type { ShellContext } from '../shell/sheets';

const config = goldenConfig('templates/baumkataster/1.0.0.yaml');
const width = (w: number): void => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  window.dispatchEvent(new Event('resize'));
  flushSync();
};
beforeEach(() => width(390));
afterEach(cleanup);

const states = new Map<string, FeatureState>(
  (
    [
      ['e1', 'baum', 'erfasst'],
      ['e2', 'baum', 'erfasst'],
      ['e3', 'baum', 'erfasst'],
      ['d1', 'baum', 'erledigt'],
      ['f1', 'flaeche', undefined],
    ] as const
  ).map(([id, type, stage]) => [
    id,
    {
      id,
      type: type as Key,
      properties: stage === undefined ? {} : { stage },
      lifecycle: 'active',
    } as unknown as FeatureState,
  ]),
);
const tap = (ids: string[]): ClusterTap =>
  ({
    at: [8, 50],
    count: ids.length,
    members: ids.map((id) => ({ id, at: [8, 50] })),
  }) as unknown as ClusterTap;

function setup(locale: 'de' | 'en' = 'de', ids = ['e1', 'e2', 'e3', 'd1', 'f1']) {
  const isolate = vi.fn();
  const mapTaps: (() => void)[] = [];
  const onclose = vi.fn();
  const ctx = {
    device: { config, classified: config, feature: (id: string) => states.get(id) },
    locale,
    map: {
      isolate,
      onMapTap: (l: () => void) => {
        mapTaps.push(l);
        return () => undefined;
      },
    },
  } as unknown as ShellContext;
  const view = render(ClusterSlot, { ctx, onclose, cluster: tap(ids) });
  return { isolate, mapTaps, onclose, view };
}

describe('the cluster sheet', () => {
  it('shows the count, the Objektarten and a row per Objektart and stage with count and share', () => {
    setup();
    expect(screen.getByRole('dialog', { name: '5 Objekte' })).toBeTruthy();
    expect(screen.getByTestId('cluster-sheet-subtitle').textContent).toBe('2 Objektarten');
    const rows = screen.getAllByTestId('cluster-row').map((r) => r.textContent?.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toContain('Erfasst');
    expect(rows[0]).toContain('3 Objekte');
    expect(rows[0]).toContain('75%');
    expect(rows[1]).toContain('1 Objekt');
    expect(rows[1]).toContain('25%');
  });

  it('is the shared shell: peek 35 vh on a phone, and 75 vh when expanded', async () => {
    setup();
    const dialog = screen.getByTestId('cluster-sheet');
    expect(dialog.style.height).toBe('35vh');
    await fireEvent.click(screen.getByRole('button', { name: 'Gruppe vergrößern oder verkleinern' }));
    expect(dialog.style.height).toBe('75vh');
  });

  it('on desktop it is the 450 px panel on the right', () => {
    width(1280);
    setup();
    const dialog = screen.getByTestId('cluster-sheet');
    expect(dialog.className).toContain('w-[450px]');
    expect(dialog.style.height).toBe('');
  });

  it('a singular Objektart reads singular; English is a real translation', () => {
    setup('en', ['e1', 'e2']);
    expect(screen.getByTestId('cluster-sheet-subtitle').textContent).toBe('Feature type');
    expect(screen.getByRole('dialog', { name: '2 features' })).toBeTruthy();
    expect(screen.getByText('2 features', { selector: 'span.text-xs' })).toBeTruthy();
  });

  it('a row isolates its members on the map and is marked; the same row again ends it', async () => {
    const { isolate } = setup();
    const [first] = screen.getAllByTestId('cluster-row');
    await fireEvent.click(first as HTMLElement);
    expect(isolate).toHaveBeenLastCalledWith(['e1', 'e2', 'e3']);
    expect(first?.getAttribute('aria-pressed')).toBe('true');
    expect(first?.className).toContain('ring-primary/30');
    await fireEvent.click(first as HTMLElement);
    expect(isolate).toHaveBeenLastCalledWith(null);
    expect(first?.getAttribute('aria-pressed')).toBe('false');
  });

  it('another row switches the isolation to its members', async () => {
    const { isolate } = setup();
    const rows = screen.getAllByTestId('cluster-row');
    await fireEvent.click(rows[0] as HTMLElement);
    await fireEvent.click(rows[1] as HTMLElement);
    expect(isolate).toHaveBeenLastCalledWith(['d1']);
    expect(rows[0]?.getAttribute('aria-pressed')).toBe('false');
  });

  it('closing the sheet ends the drill-down (the map flies back)', async () => {
    const { isolate, onclose, view } = setup();
    await fireEvent.click(screen.getAllByTestId('cluster-row')[0] as HTMLElement);
    await fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(onclose).toHaveBeenCalled();
    view.unmount();
    expect(isolate).toHaveBeenLastCalledWith(null);
  });

  it('a tap on empty map closes the sheet (v3 handleMapClick)', () => {
    const { mapTaps, onclose } = setup();
    mapTaps[0]?.();
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('passes axe', async () => {
    setup();
    const result = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});
