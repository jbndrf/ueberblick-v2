/**
 * The idle sweep of a `{ schedule, idle }` rule (WP-469, owner A10 b; v3's sweep hook (pb_hooks, lines 140-195)): at a cron
 * match the rule visits the served Objekte of its task's Objektart in id order, `limit` at a time, and fires its
 * system run only for those `idleEnough` (core) says were last changed at least `idle` ago.
 *
 * A sweep that does not end in one batch leaves ONE timers row, `feature_id = '~sweep:<start>|<last id>'`, due now:
 * the next tick resumes after the last id. The start instant is fixed when the sweep begins, so a sweep that spans
 * several ticks judges idleness at one instant (as v3's `run.at`). No new table, so no migration.
 *
 * As v3's sweep hook (lines 21-22, 112-132): pages of `SWEEP_PAGE` (50), at most `limit` Objekte per
 * rule per tick (default `SWEEP_TICK_CAP` 1000), and a time budget (`SWEEP_BUDGET_MS`, 40 s, read from the clock
 * port, R2) after which the sweep stops at a page boundary and leaves its cursor. Each Objekt is isolated: a throw
 * counts as `failed` and never aborts the page.
 */
import { servedSql, type CompiledConfig, type FeatureId, type Instant, type Run } from '@ueberblick/core';
import { idleCutoffMs, idleEnough, type ScheduleRule } from '@ueberblick/core/rules/timing';
import type { EvalContext, EvalValue } from '@ueberblick/core/expr';
import type { Db } from '../db/driver';
import type { ServerFacts, SubmitResult } from '../store';
import { fireRule } from './fire';

/** Objekte per page (v3 sweep hook, lines 21). */
export const SWEEP_PAGE = 50;
/** Objekte per rule per tick (v3 sweep hook, lines 22). */
export const SWEEP_TICK_CAP = 1000;
/** Time budget of one tick's sweep work (v3 sweep hook, lines 112). */
export const SWEEP_BUDGET_MS = 40_000;

export const SWEEP_PREFIX = '~sweep:';

export const sweepSubject = (at: Instant, cursor: string): string => `${SWEEP_PREFIX}${at}|${cursor}`;

export function parseSweep(subject: string): { at: Instant; cursor: string } | undefined {
  if (!subject.startsWith(SWEEP_PREFIX)) return undefined;
  const rest = subject.slice(SWEEP_PREFIX.length);
  const bar = rest.indexOf('|');
  return bar < 0 ? undefined : { at: rest.slice(0, bar), cursor: rest.slice(bar + 1) };
}

export interface SweepCounts {
  fired: number;
  refused: number;
  skipped: number;
  failed: number;
}

export interface SweepDeps {
  readonly db: Db;
  readonly facts: ServerFacts;
  readonly config: CompiledConfig;
  readonly version: number;
  readonly ctxOf: (at: Instant, vars: ReadonlyMap<string, EvalValue>) => EvalContext;
  readonly submit: (run: Run) => SubmitResult;
  readonly runId: () => Run['id'];
}

/** What one tick may spend on a sweep: Objekte, and the clock. `elapsedMs` is read from the clock port. */
export interface SweepBudget {
  readonly cap: number;
  readonly budgetMs: number;
  readonly elapsedMs: () => number;
}

/** One batch of the sweep after `cursor`: pages until the cap or the time budget; the last id when more may follow. */
export function sweepBatch(
  d: SweepDeps,
  rule: ScheduleRule,
  at: Instant,
  cursor: string,
  now: Instant,
  budget: SweepBudget,
): { counts: SweepCounts; last: string | undefined } {
  const counts: SweepCounts = { fired: 0, refused: 0, skipped: 0, failed: 0 };
  let visited = 0;
  let last: string | undefined;
  let from = cursor;
  while (visited < budget.cap && (visited === 0 || budget.elapsedMs() < budget.budgetMs)) {
    const size = Math.min(SWEEP_PAGE, budget.cap - visited);
    const page = sweepPage(d, rule, at, from, now, size, counts);
    visited += page.visited;
    if (page.last === undefined) return { counts, last: undefined };
    from = last = page.last;
  }
  return { counts, last };
}

function sweepPage(
  d: SweepDeps,
  rule: ScheduleRule,
  at: Instant,
  cursor: string,
  now: Instant,
  limit: number,
  counts: SweepCounts,
): { visited: number; last: string | undefined } {
  if (rule.types.length === 0) return { visited: 0, last: undefined };
  const cutoff = idleCutoffMs(rule, d.ctxOf(at, new Map()));
  const sql =
    `SELECT id FROM features WHERE type IN (${rule.types.map(() => '?').join(',')}) AND ${servedSql('lifecycle')}` +
    ` AND id > ?${cutoff === undefined ? '' : ' AND changed_at <= ?'} ORDER BY id LIMIT ?`;
  const args: (string | number)[] = [...rule.types, cursor];
  if (cutoff !== undefined) args.push(new Date(cutoff).toISOString());
  const ids = d.db.prepare<{ id: string }>(sql).all(...args, limit);
  for (const { id } of ids) {
    try {
      const state = d.facts.feature(id as FeatureId);
      const self = new Map<string, EvalValue>([['self', { $feature: id as FeatureId }]]);
      if (state === undefined || !idleEnough(rule, state.changedAt, d.ctxOf(at, self))) {
        counts.skipped++;
        continue;
      }
      const fired = fireRule(d.config, d.version, rule.key, id as FeatureId, (vars) => d.ctxOf(now, vars));
      if (!fired.fire) counts.skipped++;
      else
        counts[
          d.submit({ ...fired.run, id: d.runId(), clientTime: now }).outcome === 'accepted'
            ? 'fired'
            : 'refused'
        ]++;
    } catch {
      counts.failed++;
    }
  }
  return { visited: ids.length, last: ids.length === limit ? ids[ids.length - 1]?.id : undefined };
}
