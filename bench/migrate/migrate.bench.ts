/**
 * Budgets of the v3 migration tool (WP-300, WP-302; the removed unit asserts). docs/12 has no row for offline
 * tooling, so the limits are the removed asserts': converting the largest synthetic project <= 5 s, replaying
 * 10,000 recorded runs (diffcheck) <= 60 s. Moved from the unit specs (WP-147).
 * Run: npm test -- -c bench/vitest.config.ts bench/migrate
 */
import { describe, expect, it } from 'vitest';
import { convertConfig } from '../../apps/migrate/src/config/convert';
import { loadFixture, syntheticProject } from '../../apps/migrate/src/config/testing';
import { diffcheck } from '../../apps/migrate/src/diffcheck/diffcheck';
import { loadRuns } from '../../apps/migrate/src/diffcheck/testing';
import type { V3Run } from '../../apps/migrate/src/diffcheck/types';
import { defineBudget, report } from '../harness/budget.mjs';

describe('bench: migration tool', () => {
  it('converts 40 feature types x 30 fields in <= 5 s', () => {
    const big = syntheticProject(40, 30);
    const t0 = performance.now();
    const r = convertConfig(big);
    const s = (performance.now() - t0) / 1000;
    expect(r.check.ok).toBe(true);
    console.info(`migrate convert: ${r.report.summary.total} items in ${s.toFixed(2)} s`);
    report(
      defineBudget({
        id: 'migrate-convert',
        limit: 5,
        unit: 's',
        derivedFrom:
          'run-endpoint-p95: offline tooling with no docs/12 row; limit of the removed unit assert',
        device: 'dev-only',
        thread: 'n/a',
      }),
      Number(s.toFixed(2)),
    );
  });

  it('replays 10,000 recorded runs in <= 60 s', () => {
    const baum = convertConfig(loadFixture('baumkontrolle'));
    const baumRuns = loadRuns('baumkontrolle');
    const many: V3Run[] = [];
    for (let i = 0; i < 10_000; i++) {
      const src = baumRuns[i % baumRuns.length] as V3Run;
      many.push({ ...src, id: `${src.id}-${i}` });
    }
    const t0 = performance.now();
    const d = diffcheck(many, baum);
    const s = (performance.now() - t0) / 1000;
    expect(d.length).toBe(many.filter((r) => r.id.startsWith('unknown-task-')).length);
    console.info(`migrate diffcheck: 10,000 runs in ${s.toFixed(2)} s, ${d.length} differences`);
    report(
      defineBudget({
        id: 'migrate-diffcheck-10k',
        limit: 60,
        unit: 's',
        derivedFrom:
          'run-endpoint-p95: offline tooling with no docs/12 row; limit of the removed unit assert',
        device: 'dev-only',
        thread: 'n/a',
      }),
      Number(s.toFixed(2)),
    );
  });
});
