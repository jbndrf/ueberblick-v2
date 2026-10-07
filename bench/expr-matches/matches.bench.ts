/**
 * Budget (WP-428, R14): `matches(text, pattern)` is linear in the text. Adversarial patterns (the classic
 * backtracking killers) on a 10,000-character input answer within the interaction row (a validation while the
 * user types, main thread, x4), and the same check over 60k short values (a `visible_when` or a filter) within
 * the filter-change row. Same bundling as expr-evaluate. Run: npm run bench -- bench/expr-matches
 */
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import type * as Core from './entry';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

const out = join(mkdtempSync(join(tmpdir(), 'expr-matches-')), 'core.cjs');
buildSync({
  entryPoints: [join(import.meta.dirname, 'entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: out,
  logLevel: 'error',
});
const { matchesPattern } = createRequire(import.meta.url)(out) as typeof Core;

const median = (run: () => void, n = 5): number => {
  const t: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = performance.now();
    run();
    t.push(performance.now() - s);
  }
  return t.sort((a, b) => a - b)[Math.floor(n / 2)] as number;
};

const ADVERSARIAL = [
  '^(a*)*b$',
  '^(a|a)*b$',
  '^(a+)+$',
  '^(a|aa)+$',
  '(x+x+)+y',
  '^([a-z]+)*\\d$',
  '^(a{1,10}){1,20}c',
];

describe('matches stays linear', () => {
  it('adversarial patterns on a 10,000-character input', () => {
    const text = `${'a'.repeat(10_000)}!`;
    let worst = 0;
    for (const p of ADVERSARIAL) {
      expect(matchesPattern(text, p)).not.toBeUndefined();
      const ms = median(() => matchesPattern(text, p));
      console.log(`bench expr-matches ${p}: median ${ms.toFixed(2)} ms for 10,000 characters`);
      worst = Math.max(worst, ms);
    }
    assertBudget(
      report(
        defineBudget({
          id: 'expr-matches-adversarial-10k',
          limit: 200,
          unit: 'ms',
          row: 'interaction-to-next-paint',
          device: 'x4',
          thread: 'main',
        }),
        worst,
      ),
    );
  });

  it('an e-mail pattern over 60k short values', () => {
    const values = Array.from({ length: 60_000 }, (_, i) => `person${i}@example${i % 40}.de`);
    const pattern = '^[^@ ]+@[^@ ]+\\.[a-z]{2,}$';
    let hits = 0;
    const ms = median(() => {
      hits = 0;
      for (const v of values) if (matchesPattern(v, pattern)) hits++;
    });
    console.log(`bench expr-matches email: median ${ms.toFixed(1)} ms for 60k values, ${hits} hits`);
    expect(hits).toBe(60_000);
    assertBudget(
      report(
        defineBudget({
          id: 'expr-matches-60k',
          limit: 100,
          unit: 'ms',
          row: 'filter-change-60k',
          device: 'x4',
          thread: 'worker',
        }),
        ms,
      ),
    );
  });
});
