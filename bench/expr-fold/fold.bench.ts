/**
 * Budget (WP-670, R14, docs/12 filter-change-60k): a filter with constant timestamp and duration operands
 * (a day range, "created older than N days") over 60k features, <= 100 ms after the x4 factor. The constant
 * parts (`date('...')`, `now - days(7)`) are folded once, so a feature costs its property read and the
 * comparison. Same bundling as evaluate.bench.ts. Run: npm test -- -c bench/vitest.config.ts bench/expr-fold
 */
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import type { EvalContext, EvalValue, FeatureAccess } from '../../packages/core/src/expr/contract';
import type { Env } from '../../packages/core/src/expr/check';
import type * as Core from '../expr-evaluate/entry';
import type { FeatureId, Key } from '../../packages/core/src/model';
import { assertBudget, DOC_BUDGETS, report, type Budget } from '../harness/budget.mjs';

const out = join(mkdtempSync(join(tmpdir(), 'expr-fold-')), 'core.cjs');
buildSync({
  entryPoints: [join(import.meta.dirname, '../expr-evaluate/entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: out,
  logLevel: 'error',
});
const { check, T, createGeo, condition, parse } = createRequire(import.meta.url)(out) as typeof Core;

const N = 60_000;
const DAY = 86_400_000;
const T0 = Date.parse('2026-01-01T00:00:00Z');
const ids = Array.from({ length: N }, (_, i) => `f${i}` as FeatureId);
const dates = ids.map((_, i) => new Date(T0 + (i % 270) * DAY).toISOString());
const features: FeatureAccess = {
  property: (id, k) => (k === 'pflanzdatum' ? dates[Number(id.slice(1))] : undefined),
  related: () => [],
  history: () => [],
  type: () => 'baum' as Key,
};
const env: Env = {
  vars: { self: { kind: 'feature', type: 'baum' }, now: T.timestamp },
  features: { baum: { pflanzdatum: T.timestamp } },
};
const relations = new Map<Key, Set<Key>>();

function compile(src: string) {
  const p = parse(src);
  if (!p.ok) throw new Error(src);
  const c = check(p.ast, env, { expect: T.bool });
  if (!c.ok) throw new Error(`${src}: ${c.errors[0]?.message}`);
  return c.typed;
}

function runAll(src: string): { ms: number; hits: number } {
  const typed = compile(src);
  let hits = 0;
  const geo = createGeo();
  const t0 = performance.now();
  for (const id of ids) {
    const ctx: EvalContext = {
      vars: new Map<string, EvalValue>([['self', { $feature: id }]]),
      features,
      now: '2026-09-29T12:00:00.000Z',
      relations,
      geo,
    };
    if (condition(typed, ctx).value) hits++;
  }
  return { ms: performance.now() - t0, hits };
}

function median(src: string, runs = 7): { ms: number; hits: number } {
  for (let i = 0; i < 5; i++) runAll(src);
  const s = Array.from({ length: runs }, () => runAll(src)).sort((a, b) => a.ms - b.ms);
  return s[Math.floor(runs / 2)] as { ms: number; hits: number };
}

const RANGE = "self.pflanzdatum >= date('2026-02-01') && self.pflanzdatum <= date('2026-11-30')";
const OLDER = 'self.pflanzdatum < now - days(7)';

describe('bench: expr fold of timestamp and duration constants', () => {
  for (const [name, src] of [
    ['day range', RANGE],
    ['older than N days', OLDER],
  ] as const) {
    it(`${name} over 60k features`, () => {
      const { ms, hits } = median(src);
      console.log(`bench expr-fold ${name}: median ${ms.toFixed(1)} ms for ${N} features, ${hits} hits`);
      expect(hits).toBeGreaterThan(0);
      assertBudget(report(DOC_BUDGETS['filter-change-60k'] as Budget, ms));
    });
  }
});
