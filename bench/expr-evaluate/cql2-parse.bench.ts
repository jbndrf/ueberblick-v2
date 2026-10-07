/**
 * Budget (WP-020 CQL2 import; the removed unit assert): parsing 1,000 CQL2 filters takes <= 100 ms. docs/12 has no row
 * for it; the limit is the removed assert's. Moved from the unit spec (WP-147).
 * Run: npm test -- -c bench/vitest.config.ts bench/expr-evaluate
 */
import { describe, expect, it } from 'vitest';
import { CQL2_CASES } from '../../packages/core/src/expr/__fixtures__/cql2-cases';
import { CQL2_SPATIAL_CASES } from '../../packages/core/src/expr/__fixtures__/cql2-spatial-cases';
import { fromCql2 } from '../../packages/core/src/expr/cql2';
import { defineBudget, report } from '../harness/budget.mjs';

describe('CQL2 import', () => {
  it('parses 1,000 filters in <= 100 ms (best of 5)', () => {
    const inputs = [...CQL2_CASES, ...CQL2_SPATIAL_CASES].map((c) => c.text);
    const once = (): number => {
      const t0 = performance.now();
      for (let i = 0; i < 1000; i++) fromCql2(inputs[i % inputs.length] as string);
      return performance.now() - t0;
    };
    once(); // warm up
    const ms = Math.min(...Array.from({ length: 5 }, once));
    expect(inputs.length).toBeGreaterThan(0);
    console.info(`fromCql2: 1000 filters in ${ms.toFixed(1)} ms`);
    report(
      defineBudget({
        id: 'cql2-parse-1000',
        limit: 100,
        unit: 'ms',
        derivedFrom:
          'run-endpoint-p95: a filter is parsed on the server per request; no docs/12 row of its own, limit of the removed unit assert',
        device: 'server',
      }),
      Number(ms.toFixed(1)),
    );
  });
});
