// @vitest-environment jsdom
/**
 * Budget (docs/12): the first render of the app shell is one interaction-to-next-paint (<= 200 ms); the shell
 * gets half, 100 ms, on the reference phone (jsdom time x4). Median of 15 runs.
 * Run: npm test -- -c bench/vitest.config.ts bench/ui-shell
 */
import { describe, it } from 'vitest';
import { render } from '@testing-library/svelte';
import type { TemplateFile } from '@ueberblick/core/model';
import AppShell from '../../packages/ui/src/shell/testing/Harness.svelte';
import { deriveShellModel } from '../../packages/ui/src/shell/model';
import type { StatusModel } from '../../packages/ui/src/shell/contract';
import { defineBudget, report } from '../harness/budget.mjs';

const file = {
  schema: '1',
  template: { key: 't', version: '1.0.0' },
  roles: {
    worker: {
      label: 'Worker',
      app: {
        home: 'mein',
        views: { mein: {}, alle: {} },
        tools: { photo: {} },
        shortcuts: { kontrolle: {} },
        ui: { theme: 'outdoor' },
      },
    },
  },
  views: { alle: { label: 'All trees' }, mein: { label: 'Mine' } },
  tools: { photo: {}, gps: {} },
  tasks: {
    kontrolle: { label: 'Inspection', on: { create: 'baum' } },
    melden: { label: 'Report', on: { create: 'schaden' } },
  },
} as unknown as TemplateFile;

const status: StatusModel = {
  online: true,
  lastSyncedAt: '2026-09-29T08:00:00Z',
  pending: 0,
  oldestPendingAge: null,
  refused: [],
  storage: 'ok',
};

const RUNS = 15;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

describe('bench: app shell', () => {
  it('renders the shell for the worker role', () => {
    const props = () => ({
      model: deriveShellModel({ file, roleKey: 'worker', locale: 'en' }),
      status,
      onexport: () => undefined,
    });
    for (let i = 0; i < 3; i++) render(AppShell, props()).unmount();
    const runs: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      const r = render(AppShell, props());
      runs.push(performance.now() - t0);
      r.unmount();
    }
    report(
      defineBudget({
        id: 'app-shell-first-render',
        limit: 100,
        unit: 'ms',
        derivedFrom: 'interaction-to-next-paint: first render of the app shell',
        device: 'x4',
        thread: 'main',
      }),
      Number(median(runs).toFixed(1)),
    );
  });
});
