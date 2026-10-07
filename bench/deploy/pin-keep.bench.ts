/**
 * Budget (WP-317, docs/12): a deploy with `keep` over 10k running features writes 10k `$pin` system runs inside the deploy
 * transaction, before the new version becomes the deployed one. The whole deploy must stay within the deploy budget of
 * 2 s (docs/12). Run: npm test -- -c bench/vitest.config.ts bench/deploy/pin-keep
 */
import { describe, expect, it } from 'vitest';
import type { FeatureId, Key, RunId, TemplateFile } from '../../packages/core/src';
import { openProjectDb } from '../../packages/server/src/db/open';
import { deployProject } from '../../packages/server/src/deploy';
import { composeProjectStore } from '../../packages/server/src/http/shared/stores';
import { createLogger } from '../../packages/server/src/log';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

const clock = { now: () => '2026-10-02T10:00:00Z' };
const file = (label: string): TemplateFile =>
  ({
    schema: 'ueberblick/1',
    template: { key: 'pins', version: '1.0.0' },
    roles: { maker: { label: 'Maker' } },
    types: {
      baum: {
        label,
        permissions: { see: '$all', create: '$all', write: '$all' },
        properties: { stage: { type: 'select', options: { a: 'A', b: 'B' } } },
      },
    },
    tasks: { anlegen: { label: 'Anlegen', on: '$map', creates: 'baum', form: { stage: {} } } },
  }) as unknown as TemplateFile;

describe('bench: deploy with keep', () => {
  it('pins 10k running features inside one deploy within the deploy budget', () => {
    const db = openProjectDb(':memory:', 'bench');
    const log = createLogger({ sink: () => undefined, now: () => 1 });
    const store = composeProjectStore(db, { clock, log, onOrphanedBlobs: () => undefined });
    let n = 0;
    const ids = { runId: () => `20000000-0000-7000-8000-${String(++n).padStart(12, '0')}` as RunId };
    const deps = { clock, afterDeploy: () => undefined, pins: { store, ids } };
    deployProject(db, file('Baum'), 'root', deps);
    // Real runs, so every feature has its `$type` observation and the pin folds like production.
    for (let from = 0; from < 10_000; from += 500)
      store.submitBatch(
        Array.from({ length: 500 }, (_, k) => {
          const i = from + k + 1;
          const tail = String(i).padStart(12, '0');
          return {
            id: `10000000-0000-7000-8000-${tail}` as RunId,
            task: 'anlegen' as Key,
            actor: { id: 'root', kind: 'admin' as const, roles: [] },
            configVersion: 1,
            featureId: `00000000-0000-7000-8000-${tail}` as FeatureId,
            input: { stage: 'a' },
          };
        }),
      );
    const t0 = performance.now();
    const r = deployProject(db, file('Baum neu'), 'root', deps, {}, { baum: 'keep' });
    const total = performance.now() - t0;
    expect(r.ok && r.pinned).toBe(10_000);
    const count = db
      .prepare<{ n: number }>('SELECT count(*) AS n FROM features WHERE pinned_version = 1')
      .get()?.n;
    expect(count).toBe(10_000);
    console.info(`deploy keep: 10k pins in ${total.toFixed(0)} ms`);
    assertBudget(
      report(
        defineBudget({
          id: 'deploy-keep-10k',
          limit: 2000,
          unit: 'ms',
          derivedFrom:
            'deploy budget of 2 s (bench/deploy): the pins are written in the deploy transaction, never async, so no feature floats on the new version',
          device: 'server',
        }),
        Math.round(total),
      ),
    );
  }, 120_000);
});
