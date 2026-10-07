/**
 * Budget (WP-665, R14): applying a saved view written by the view builder over 60k features of one type. The budget
 * row `filter-change-60k` (docs/12) is <= 100 ms for a three-clause filter; the builder writes rule-language source and
 * the evaluation is core's `applyFilter` (one `canSee` and one condition per feature), so the number is core's.
 *  1. A three-row view (text, number range, choice): asserted against the budget row.
 *  2. A view of all the builder's rows: reported. Each plain term costs about 0.5 us per feature, so seven rows are above
 *     the three-clause row by construction.
 *  3. A day range, or "created older than N days", as the only row: asserted. Before WP-670 these took 434 and 346 ms
 *     (core parsed a timestamp on every comparison); with the folded timestamp terms they fit the row.
 * The creator list for the "Erstellt von" row is one pass over the features (once when the row opens, not per
 * interaction). Median of 5 after a warm-up.
 * Run: npm test -- -c bench/vitest.config.ts bench/filters
 */
import { describe, expect, it } from 'vitest';
import {
  actorOf,
  envOver,
  featureOf,
  viewsWorld,
} from '../../packages/core/src/filters/__fixtures__/views-world';
import {
  applyFilter,
  builderContext,
  clausesToFilter,
  compileFilter,
  creatorIds,
  type Clause,
} from '../../packages/core/src/filters';
import { assertBudget, DOC_BUDGETS, report, type Budget } from '../harness/budget.mjs';

const N = 60_000;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;
const DAY = 86_400_000;
const T0 = Date.parse('2026-01-01T00:00:00Z');

const config = viewsWorld();
const actor = actorOf(['kontrolle'], 'u1');
const ctx = builderContext(config, actor, 'de');
const base = { kind: 'field' as const, type: 'baum' };
const text: Clause = { ...base, key: 'name', propType: 'text', editor: 'text', text: 'eiche' };
const range: Clause = { ...base, key: 'hoehe', propType: 'number', editor: 'number', min: 3, max: 15 };
const choice: Clause = {
  ...base,
  key: 'art',
  propType: 'select',
  editor: 'choice',
  values: ['eiche', 'linde'],
};
const days: Clause = {
  ...base,
  key: 'pflanzdatum',
  propType: 'date',
  editor: 'date',
  from: '2026-02-01',
  to: '2026-11-30',
};
const stage: Clause = { kind: 'stage', type: 'baum', values: ['neu', 'geprueft'] };
const by: Clause = { kind: 'created_by', values: ['u1', 'u2', 'u3'] };
const older: Clause = { kind: 'when', field: 'created', mode: 'older', days: 7, from: null, to: null };

const all = Array.from({ length: N }, (_, i) =>
  featureOf(
    `f${i}`,
    'baum',
    {
      name: i % 3 === 0 ? 'alte eiche' : 'linde',
      hoehe: i % 20,
      pflanzdatum: `2026-0${1 + (i % 9)}-15`,
      art: i % 2 === 0 ? 'eiche' : 'linde',
      stufe: ['neu', 'geprueft', 'fertig'][i % 3] as string,
    },
    {
      createdBy: `u${1 + (i % 5)}`,
      createdAt: new Date(T0 + (i % 270) * DAY).toISOString(),
      changedAt: new Date(T0 + (i % 270) * DAY).toISOString(),
    },
  ),
);
const env = envOver(config, actor, all);

/** Median ms of compiling and applying the view of these rows. */
function time(rows: readonly Clause[]): number {
  const filters = clausesToFilter(rows, ctx.types, () => 'stufe');
  const once = (): number => {
    const t0 = performance.now();
    const compiled = compileFilter(env.config, filters);
    if (!compiled.ok) throw new Error('compile');
    const passed = applyFilter(env, compiled.filter, 'baum', all);
    const ms = performance.now() - t0;
    expect(passed.length).toBeGreaterThan(0);
    return ms;
  };
  once(); // warm up
  return Number(median(Array.from({ length: 5 }, once)).toFixed(1));
}

describe('applying a saved view over 60k features of one type', () => {
  it('a three-row view takes <= 100 ms (median of 5)', () => {
    const ms = time([text, range, choice]);
    console.info(`view of three rows over 60k: ${ms} ms (median of 5)`);
    assertBudget(report(DOC_BUDGETS['filter-change-60k'] as Budget, ms));
  });

  it('a view of all the builder rows is reported', () => {
    console.info(`view of seven rows over 60k: ${time([text, range, days, choice, stage, by, older])} ms`);
  });

  it('a day range alone and "created older than 7 days" alone take <= 100 ms', () => {
    for (const [name, row] of [
      ['day range', days],
      ['created older than 7 days', older],
    ] as const) {
      const ms = time([row]);
      console.info(`${name} row alone over 60k: ${ms} ms`);
      assertBudget(report(DOC_BUDGETS['filter-change-60k'] as Budget, ms));
    }
  });

  it('lists the creators of 60k features in one pass', () => {
    const t0 = performance.now();
    const creators = creatorIds(all);
    const ms = Number((performance.now() - t0).toFixed(1));
    console.info(`creators of 60k features: ${ms} ms, ${creators.length} people`);
    expect(creators).toHaveLength(5);
  });
});
