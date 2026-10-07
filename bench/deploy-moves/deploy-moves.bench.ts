/**
 * Budget (WP-307): a deploy that moves one option of 20k features out of 60k. The executor must not block requests:
 * its longest transaction (a batch of <= 500 `$move` runs) <= 500 ms, and the whole move is measured and reported.
 * Run: npm test -- -c bench/vitest.config.ts bench/deploy-moves
 */
import { describe, expect, it } from 'vitest';
import type { RunId, TemplateFile } from '../../packages/core/src';
import { openProjectDb } from '../../packages/server/src/db/open';
import { createMoveExecutor, deployProject } from '../../packages/server/src/deploy';
import { composeProjectStore } from '../../packages/server/src/http/shared/stores';
import { createLogger } from '../../packages/server/src/log';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

const clock = { now: () => '2026-10-01T10:00:00Z' };
const file = (options: Record<string, string>): TemplateFile =>
  ({
    schema: 'ueberblick/1',
    template: { key: 'moves', version: '1.0.0' },
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

describe('bench: deploy value moves', () => {
  it('moves 20k of 60k features in batches of 500, none blocking for more than 500 ms', async () => {
    const db = openProjectDb(':memory:', 'bench');
    const log = createLogger({ sink: () => undefined, now: () => 1 });
    const store = composeProjectStore(db, { clock, log, onOrphanedBlobs: () => undefined });
    const deps = { clock, afterDeploy: () => undefined };
    deployProject(db, file({ a: 'A', b: 'B', c: 'C' }), 'root', deps);
    const put = db.prepare(
      "INSERT INTO features (id, type, config_version, properties, updated_seq) VALUES (?, 'baum', 1, ?, ?)",
    );
    db.transaction(() => {
      for (let i = 0; i < 60_000; i++)
        put.run(`f${String(i).padStart(6, '0')}`, JSON.stringify({ stage: i % 3 === 0 ? 'b' : 'a' }), i + 1);
    });
    const path = 'types.baum.properties.stage.options.b';
    const dep = deployProject(db, file({ a: 'A', c: 'C' }), 'root', deps, { [path]: { to: 'c' } });
    expect(dep.ok && dep.diff.find((d) => d.path === path)?.affected).toBe(20_000);

    let n = 0;
    let last = performance.now();
    let longest = 0;
    const ex = createMoveExecutor(db, {
      store,
      ids: { runId: () => `20000000-0000-7000-8000-${String(++n).padStart(12, '0')}` as RunId },
      pause: () => {
        last = performance.now();
        return Promise.resolve();
      },
      afterBatch: () => {
        longest = Math.max(longest, performance.now() - last);
      },
    });
    last = performance.now();
    const t0 = performance.now();
    const r = await ex.run();
    const total = performance.now() - t0;
    expect(r.moved).toBe(20_000);
    console.info(
      `deploy moves: 20k features in ${total.toFixed(0)} ms, longest batch ${longest.toFixed(0)} ms`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'deploy-moves-longest-batch',
          limit: 500,
          unit: 'ms',
          derivedFrom:
            'a move of 20k features must not block requests: the executor holds the database for one batch (<= 500 runs) at a time, yielding between batches; 500 ms is one slow-request tolerance',
          device: 'dev-only',
          thread: 'main',
        }),
        Number(longest.toFixed(0)),
      ),
    );
  }, 300_000);
});
