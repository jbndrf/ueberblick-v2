/**
 * Budget (WP-640, R14): changing the active filter over 60k features of one type, with a three-clause filter,
 * takes <= 100 ms (docs/12 row `filter-change-60k`). It is O(features of one type) per filter change, never per
 * interaction or per sync page. The filter is compiled once; each feature costs one `canSee` and one evaluation.
 * Median of 5 runs after a warm-up. Run through vitest (the golden assets need its import.meta.glob), so module
 * calls cost a little more than in the shipped bundle: the number is an upper bound.
 * Run: npm test -- -c bench/vitest.config.ts bench/filters
 */
import { describe, expect, it } from 'vitest';
import { actor, envFor, feature, world } from '../../packages/core/src/filters/__fixtures__/world';
import { applyFilter, compileFilter } from '../../packages/core/src/filters';
import { assertBudget, DOC_BUDGETS, report, type Budget } from '../harness/budget.mjs';

const N = 60_000;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

describe('filter change over 60k features of one type', () => {
  it('a three-clause filter takes <= 100 ms (median of 5)', () => {
    const all = Array.from({ length: N }, (_, i) =>
      feature(`f${i}`, 'baum', {
        status: i % 3 === 0 ? 'krank' : 'ok',
        hoehe: i % 20,
        zustaendig: `u${i % 5}`,
      }),
    );
    const env = envFor(world(), actor(['kontrolle'], 'u1'), all);
    const r = compileFilter(env.config, {
      baum: "self.hoehe > 5 && self.status == 'krank' || self.zustaendig == actor.id",
    });
    if (!r.ok) throw new Error('compile');
    const once = (): number => {
      const t0 = performance.now();
      const passed = applyFilter(env, r.filter, 'baum', all);
      const ms = performance.now() - t0;
      expect(passed.length).toBeGreaterThan(0);
      return ms;
    };
    once(); // warm up
    const ms = Number(median(Array.from({ length: 5 }, once)).toFixed(1));
    console.info(`filter 60k, three clauses: ${ms} ms (median of 5)`);
    assertBudget(report(DOC_BUDGETS['filter-change-60k'] as Budget, ms));
  });
});
