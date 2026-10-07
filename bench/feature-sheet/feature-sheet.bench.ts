// @vitest-environment jsdom
/**
 * Budget (docs/12, WP-525): opening a sheet (50 properties, 10 relations) is one interaction-to-next-paint
 * (<= 200 ms); the sheet render gets half, 100 ms, on the reference phone (jsdom time x4). Median of 15 runs.
 * Run: npm test -- -c bench/vitest.config.ts bench/feature-sheet
 */
import { describe, it } from 'vitest';
import { render } from '@testing-library/svelte';
import type { FeatureType, FoldedFeature, Property } from '@ueberblick/core';
import FeatureSheet from '../../apps/web/src/lib/participant/feature/FeatureSheet.svelte';
import DataTab from '../../apps/web/src/lib/participant/feature/DataTab.svelte';
import { buildFeatureSheetModel } from '../../packages/ui/src/feature-sheet/model';
import '../../packages/ui/src/components/ui/jsdom-shims.testing';
import { defineBudget, report } from '../harness/budget.mjs';
import { edge, fid, input, k } from '../../packages/ui/src/feature-sheet/fixtures';

const kinds: Property[] = [
  { type: 'text' },
  { type: 'number' },
  { type: 'date' },
  { type: 'datetime' },
  { type: 'boolean' },
  { type: 'select', options: { a: { en: 'A' } } },
  { type: 'participant' },
];
const values = ['x', 3.5, '2026-01-02', '2026-01-02T03:04:05Z', true, 'a', 'p1'];

function big() {
  const properties: Record<string, Property> = {};
  const held: Record<string, unknown> = {};
  for (let i = 0; i < 50; i++) {
    properties[`p${i}`] = { ...(kinds[i % 7] as Property), label: `Property ${i}` };
    held[`p${i}`] = values[i % 7];
  }
  const type: FeatureType = { label: 'Big', properties };
  const feature = {
    id: fid('f'),
    type: k('big'),
    lifecycle: 'active',
    updatedSeq: 1,
    properties: held,
    derived: {},
  };
  const edgesOut = Array.from({ length: 10 }, (_, i) => edge('f', `r${i % 3}`, `g${i}`, i % 2 === 0));
  return input({ feature: feature as unknown as FoldedFeature, type, types: { big: type }, edgesOut });
}

const RUNS = 15;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

describe('bench: feature sheet', () => {
  const args = big();
  const sheet = (model: ReturnType<typeof buildFeatureSheetModel>) => ({
    open: true,
    model,
    locale: 'en' as const,
    now: '2026-03-10T12:00:00Z' as never,
    onclose: () => undefined,
    onstart: () => undefined,
    onopen: () => undefined,
  });
  const data = (model: ReturnType<typeof buildFeatureSheetModel>) => ({
    model,
    locale: 'en' as const,
    onopen: () => undefined,
  });
  const budget = (id: string, derivedFrom: string) =>
    defineBudget({ id, limit: 100, unit: 'ms', derivedFrom: derivedFrom, device: 'x4', thread: 'main' });
  const measure = (run: () => { unmount: () => void }): number => {
    for (let i = 0; i < 3; i++) run().unmount(); // warm-up: JIT and jsdom set-up are not the sheet
    const runs: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      const r = run();
      runs.push(performance.now() - t0);
      r.unmount();
    }
    return Number(median(runs).toFixed(1));
  };

  it('opens a feature with 50 properties and 10 relations (model, header, action row, tabs)', () => {
    report(
      budget(
        'feature-sheet-open-50x10',
        'interaction-to-next-paint: opening a feature sheet (the Aktivitaet tab shows first, as in v3)',
      ),
      measure(() => render(FeatureSheet, sheet(buildFeatureSheetModel(args)))),
    );
  });

  it('shows the Daten tab with 50 properties and 10 relations', () => {
    const model = buildFeatureSheetModel(args);
    report(
      budget('feature-sheet-data-50x10', 'interaction-to-next-paint: switching to the Daten tab'),
      measure(() => render(DataTab, data(model))),
    );
  });
});
