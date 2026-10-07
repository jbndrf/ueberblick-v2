/**
 * Budget (WP-368, docs/12): the manual move of 10k pinned features writes 10k `$pin` unpin runs and 10k `$move` runs,
 * batched like a deploy, in one transaction. Twice the runs of the 10k keep deploy (bench/deploy/pin-keep, 2 s), so
 * 5 s with headroom. The selection uses the partial index `features_pinned`.
 * Run: npm test -- -c bench/vitest.config.ts bench/deploy/pin-move
 */
import { describe, expect, it } from 'vitest';
import type { FeatureId, Key, RunId, TemplateFile } from '../../packages/core/src';
import { openProjectDb } from '../../packages/server/src/db/open';
import { deployProject, movePins } from '../../packages/server/src/deploy';
import { composeProjectStore } from '../../packages/server/src/http/shared/stores';
import { createLogger } from '../../packages/server/src/log';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

const clock = { now: () => '2026-10-02T10:00:00Z' };
const OPT = 'types.baum.properties.stage.options.b';
const file = (options: Record<string, string>): TemplateFile =>
  ({
    schema: 'ueberblick/1',
    template: { key: 'pins', version: '1.0.0' },
    roles: { maker: { label: 'Maker' } },
    types: {
      baum: {
        label: 'Baum',
        permissions: { see: '$all', create: '$all', write: '$all' },
        properties: { stage: { type: 'select', options } },
      },
    },
    tasks: { anlegen: { label: 'Anlegen', on: '$map', creates: 'baum', form: { stage: {} } } },
  }) as unknown as TemplateFile;

describe('bench: manual move of pinned features', () => {
  it('moves 10k pinned features (unpin plus value move) within the budget', () => {
    const db = openProjectDb(':memory:', 'bench');
    const log = createLogger({ sink: () => undefined, now: () => 1 });
    const store = composeProjectStore(db, { clock, log, onOrphanedBlobs: () => undefined });
    let n = 0;
    const ids = { runId: () => `20000000-0000-7000-8000-${String(++n).padStart(12, '0')}` as RunId };
    const pins = { store, ids };
    const deps = { clock, afterDeploy: () => undefined, pins };
    deployProject(db, file({ a: 'A', b: 'B' }), 'root', deps);
    for (let from = 0; from < 10_000; from += 500)
      store.submitBatch(
        Array.from({ length: 500 }, (_, k) => {
          const tail = String(from + k + 1).padStart(12, '0');
          return {
            id: `10000000-0000-7000-8000-${tail}` as RunId,
            task: 'anlegen' as Key,
            actor: { id: 'root', kind: 'admin' as const, roles: [] },
            configVersion: 1,
            featureId: `00000000-0000-7000-8000-${tail}` as FeatureId,
            input: { stage: 'b' },
          };
        }),
      );
    const kept = deployProject(db, file({ a: 'A' }), 'root', deps, { [OPT]: { to: 'a' } }, { baum: 'keep' });
    expect(kept.ok && kept.pinned).toBe(10_000);
    const t0 = performance.now();
    const r = movePins(db, pins, 1, { [OPT]: { to: 'a' } });
    const total = performance.now() - t0;
    expect(r).toMatchObject({ ok: true, unpinned: 10_000, moved: 10_000 });
    console.info(`pin move: 10k unpin + 10k move runs in ${total.toFixed(0)} ms`);
    assertBudget(
      report(
        defineBudget({
          id: 'pin-move-10k',
          limit: 5000,
          unit: 'ms',
          derivedFrom:
            'twice the runs of the 10k keep deploy (2 s, bench/deploy/pin-keep): 10k unpin runs plus 10k value-move runs, batched at 500 inside one transaction',
          device: 'server',
        }),
        Math.round(total),
      ),
    );
  }, 120_000);
});
