/**
 * Budget (WP-535): export of one subject with 10,000 observations, streamed to the last byte <= 5 s. It derives from
 * the "Snapshot of 60k features" row of docs/12 (a streamed read of one project's data on one vCPU).
 * Run: npm test -- -c bench/vitest.config.ts bench/export-subject
 */
import { describe, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { exportSubject } from '../../packages/server/src/export-subject';
import { world } from '../../packages/server/src/export-subject/world.testkit';

describe('bench: subject export', () => {
  it('10k observations of one subject, streamed', async () => {
    const w = world();
    try {
      w.run('r1', 'p1');
      w.db.transaction(() => {
        for (let i = 0; i < 10_000; i++) w.obs('r1', `f${i % 200}`, i % 2 ? 'titel' : 'melder', `Wert ${i}`);
      });
      const times: number[] = [];
      let bytes = 0;
      for (let round = 0; round < 5; round++) {
        const t = performance.now();
        bytes = 0;
        for await (const c of exportSubject(w.project, 'p1', 'admin')) bytes += c.length;
        times.push(performance.now() - t);
      }
      const worst = Math.max(...times);
      console.log(`subject export 10k observations: worst of 5 ${worst.toFixed(0)} ms, ${bytes} bytes`);
      assertBudget(
        report(
          defineBudget({
            id: 'export-subject-10k-ms',
            limit: 5000,
            unit: 'ms',
            derivedFrom:
              'Snapshot of 60k features: a streamed read of one subject (WP-535: 10k observations in 5 s)',
            device: 'server',
          }),
          Number(worst.toFixed(0)),
        ),
      );
    } finally {
      w.dispose();
    }
  });
});
