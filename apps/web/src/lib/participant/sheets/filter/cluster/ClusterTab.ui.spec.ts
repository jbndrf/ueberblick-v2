// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { JsonValue } from '@ueberblick/core/model';
import type { UnclusterStats } from '@ueberblick/ui';
import '@ueberblick/ui/testing';
import { axeViolations } from '@ueberblick/ui/testing';
import ClusterTab from './ClusterTab.svelte';

function setup(initial: Record<string, JsonValue> = {}, locale: 'de' | 'en' = 'de') {
  let prefs: Record<string, JsonValue> = { ...initial };
  const listeners = new Set<() => void>();
  const writes: [string, JsonValue][] = [];
  const person = {
    preferencesOf: () => prefs,
    setPreference: (_t: string, name: string, value: JsonValue) => {
      writes.push([name, value]);
      prefs = { ...prefs, [name]: value };
      for (const l of listeners) l();
    },
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  let report: ((s: UnclusterStats) => void) | undefined;
  const map = {
    onUnclusterStats: (l: (s: UnclusterStats) => void) => ((report = l), () => (report = undefined)),
  };
  const view = render(ClusterTab, { locale, person, map });
  return { ...view, writes, report: (s: UnclusterStats) => report?.(s) };
}

describe('ClusterTab (v3 clusterBody)', () => {
  it('shows the switch with its description; the cap field only while it is on', async () => {
    const t = setup();
    expect(screen.getByText('Gruppierung aufheben')).toBeTruthy();
    expect(screen.getByText('Einzelne Marker in der aktuellen Ansicht anzeigen')).toBeTruthy();
    expect(screen.queryByLabelText('Bis zu')).toBeNull();
    await fireEvent.click(screen.getByRole('switch', { name: 'Gruppierung aufheben' }));
    expect(t.writes).toEqual([['uncluster', true]]);
    const cap = screen.getByLabelText('Bis zu') as HTMLInputElement;
    expect(cap.value).toBe('500');
    expect(cap.min).toBe('1');
    expect(cap.step).toBe('50');
  });

  it('a valid cap is saved; an invalid one is ignored and the field shows the cap in force', async () => {
    const t = setup({ uncluster: true });
    const cap = screen.getByLabelText('Bis zu') as HTMLInputElement;
    await fireEvent.change(cap, { target: { value: '250' } });
    expect(t.writes).toEqual([['cap', 250]]);
    for (const bad of ['0', '-4', '']) {
      await fireEvent.change(cap, { target: { value: bad } });
      expect(cap.value).toBe('250');
    }
    expect(t.writes).toHaveLength(1);
  });

  it('stats line: singly drawn, or too many and still clustered; hidden with nothing in view', async () => {
    const t = setup({ uncluster: true });
    expect(document.querySelector('[data-cluster-stats]')).toBeNull();
    t.report({ inView: 12, single: true });
    expect(await screen.findByText('12 einzeln angezeigt')).toBeTruthy();
    t.report({ inView: 900, single: false });
    expect(await screen.findByText('900 im Blickfeld — zu viele, noch gruppiert')).toBeTruthy();
    t.report({ inView: 0, single: false });
    await Promise.resolve();
    expect(document.querySelector('[data-cluster-stats]')).toBeNull();
  });

  it('follows a change of the record (another device, a reload)', async () => {
    const t = setup({ uncluster: false });
    expect(screen.queryByLabelText('Bis zu')).toBeNull();
    await fireEvent.click(screen.getByRole('switch', { name: 'Gruppierung aufheben' }));
    expect(screen.getByLabelText('Bis zu')).toBeTruthy();
    t.unmount();
  });

  it('speaks English', () => {
    setup({ uncluster: true }, 'en');
    expect(screen.getByText('Uncluster')).toBeTruthy();
    expect(screen.getByLabelText('Up to')).toBeTruthy();
  });

  it('has no axe violations, off and on', async () => {
    setup();
    const tab = document.querySelector('[data-cluster-tab]') as Element; // the sheet is the landmark in the app
    expect(await axeViolations(tab)).toEqual([]);
    await fireEvent.click(screen.getByRole('switch', { name: 'Gruppierung aufheben' }));
    expect(await axeViolations(tab)).toEqual([]);
  });
});
