// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { FeatureId } from '@ueberblick/core/model';
import FeatureList from './FeatureList.svelte';
import { BATCH, first, more } from './feature-list/incremental';

const labels = {
  caption: 'Trees',
  empty: 'Nothing',
  sortedAscending: 'asc',
  sortedDescending: 'desc',
  name: 'Name',
};
const columns = [{ key: 'height', label: 'Height' }];
const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `id-${String(i).padStart(5, '0')}` as FeatureId,
    name: `Tree ${String(i).padStart(5, '0')}`,
    properties: { height: n - i },
  }));
const bodyRows = () => document.querySelectorAll('tbody tr.ub-row');

let fire: (() => void) | undefined;
beforeEach(() => {
  fire = undefined;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: (e: { isIntersecting: boolean }[]) => void) {
        fire = () => cb([{ isIntersecting: true }]);
      }
      observe(): void {}
      disconnect(): void {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('incremental rows (WP-862)', () => {
  it('batch helpers stay within the total', () => {
    expect(first(5)).toBe(5);
    expect(first(1000)).toBe(BATCH);
    expect(more(BATCH, 1000)).toBe(2 * BATCH);
    expect(more(950, 1000)).toBe(1000);
  });

  it('draws only the first batch, and the table states its full size', () => {
    render(FeatureList, { features: rows(250), columns, labels, onFeatureTap: () => undefined });
    expect(bodyRows()).toHaveLength(BATCH);
    expect(document.querySelector('table')?.getAttribute('aria-rowcount')).toBe('251');
    expect(bodyRows()[0]?.getAttribute('aria-rowindex')).toBe('2');
    expect(bodyRows()[BATCH - 1]?.getAttribute('aria-rowindex')).toBe(String(BATCH + 1));
  });

  it('a short list is drawn in full', () => {
    render(FeatureList, { features: rows(3), columns, labels, onFeatureTap: () => undefined });
    expect(bodyRows()).toHaveLength(3);
  });

  it('scrolling near the end appends the next batch, until all are drawn', () => {
    render(FeatureList, { features: rows(250), columns, labels, onFeatureTap: () => undefined });
    fire?.();
    return Promise.resolve().then(async () => {
      await Promise.resolve();
      expect(bodyRows()).toHaveLength(2 * BATCH);
      fire?.();
      await Promise.resolve();
      expect(bodyRows()).toHaveLength(250);
    });
  });

  it('focus reaching the last drawn row appends the next batch', async () => {
    render(FeatureList, { features: rows(250), columns, labels, onFeatureTap: () => undefined });
    const lastButton = bodyRows()[BATCH - 1]?.querySelector('button');
    if (!lastButton) throw new Error('no last row');
    await fireEvent.focusIn(lastButton);
    expect(bodyRows()).toHaveLength(2 * BATCH);
  });

  it('sorting orders all rows, then redraws from the top', async () => {
    render(FeatureList, { features: rows(250), columns, labels, onFeatureTap: () => undefined });
    fire?.();
    await Promise.resolve();
    await fireEvent.click(screen.getByRole('button', { name: 'Height' }));
    expect(bodyRows()).toHaveLength(BATCH);
    // height ascending: the last tree has height 1
    expect(bodyRows()[0]?.getAttribute('data-feature-id')).toBe('id-00249');
  });
});
