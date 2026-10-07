/**
 * Server timers (WP-108). CONTRACT: changes need the lead.
 *
 * Time-based rules (`on: { elapsed }` and `on: { schedule }`) are server-only (docs/07, decision 0020). Each one is a
 * row of `timers (feature_id, rule, due_at)`, and a due row becomes a system run through `store.submit` (R3), so
 * plan, permissions, rules and the seq all apply as for any run.
 *
 * - **Scheduling is a `TransactionHook`** (`Timers.hook`, register it in `StoreDeps.hooks`): in the run's own
 *   transaction, for every feature the run created or changed, each `elapsed` rule of its type gets its `due_at`
 *   (`from + after + offset`, evaluated on the folded state) written, replacing the row of the same
 *   `(feature_id, rule)`. A rule is only re-evaluated when the run created or restored the feature or wrote a property
 *   its expressions read, so a fired timer does not come back on an unrelated edit. No value (`from` is null) or a
 *   deleted feature removes the row.
 * - **`schedule` rules** belong to no feature: their row has `feature_id = ''` (`SCHEDULE_SUBJECT`). `syncSchedules`
 *   creates the missing rows; after a firing the next time is the first cron match after the tick's `now`.
 * - **Idle sweep** (`{ schedule, idle }`, WP-469, `sweep.ts`): at a cron match the rule visits the served Objekte of
 *   its task's Objektart in id order (pages of 50, at most `sweepCap` = 1000 per tick, a 40 s clock budget), and fires per Objekt that core's `idleEnough` accepts
 *   (last change + `idle` <= the sweep's start). Unfinished, it leaves one row `feature_id = '~sweep:<start>|<last id>'`,
 *   due now, which the next tick resumes; one sweep per rule at a time. A failing Objekt counts as `failed`, never aborts the page.
 * - **`tick(now)`** takes the rows with `due_at <= now` (oldest first, at most `limit`) and, per row and in ONE
 *   transaction, deletes it, evaluates the rule's `when` and `with` and submits the run. A row therefore fires exactly
 *   once, at the first tick at or after its `due_at`. `when` false, a feature that is gone, or a rule that is no longer in
 *   the config consume the row without a run; a refused run consumes it too (the refusal is in the ledger). A throw
 *   rolls that row back (it fires again on the next tick) and does not stop the other rows.
 * - **Per version (A-029, WP-318):** an `elapsed` row is scheduled, evaluated and fired under its subject's effective
 *   version (`coalesce(pinned_version, deployed)`), which it records as `config_version`. A `$version` run (pin or unpin)
 *   rebuilds the feature's rows under the new version in the same hook; a deploy's `rebuild` does it for the floating
 *   features. A due row whose `config_version` is no longer its subject's version is rescheduled, never fired stale.
 *   `schedule` rules have no subject and stay on the deployed version.
 * - A `schedule` rule with no run inside `CRON_HORIZON_DAYS` is not scheduled. That is never silent: deploy and plan
 *   list it as a warning (`warnings.ts`), and `syncSchedules` and the re-schedule after a firing log one
 *   `timer.dropped` line per rule per config version.
 * - Times are UTC. A `date` value means midnight UTC.
 */
import type { FeatureId, Geo, Ids, Instant, Clock, Key, Run } from '@ueberblick/core';
import type { Logger } from '../log';
import type { Db } from '../db/driver';
import type { SubmitResult, TransactionHook } from '../store';
import type { VersionResolver } from '../store/run/config-for';

/** `timers.feature_id` of a `schedule` rule. */
export const SCHEDULE_SUBJECT = '';

export interface TimersDeps {
  readonly clock: Clock;
  readonly ids: Ids;
  readonly geo: Geo;
  /** The shared resolver of the project's versions (A-029): the one cache, never a second one (R1). */
  readonly versions: VersionResolver;
  /** `store.submit`. A function, so the timers exist before the store (their hook is one of its deps). */
  readonly submit: (run: Run) => SubmitResult;
  /** Where dropped-rule warnings go (event `timer.dropped`): once per rule per config version. */
  readonly log: Logger;
}

export interface TickResult {
  /** Runs accepted. */
  readonly fired: number;
  /** Runs the plan refused. */
  readonly refused: number;
  /** Rows consumed without a run (`when` false, feature gone, rule gone). */
  readonly skipped: number;
  /** Rows left for the next tick because the run threw. */
  readonly failed: number;
}

export interface Timers {
  /** Schedules elapsed rules inside the run transaction. Register it in `StoreDeps.hooks`. */
  readonly hook: TransactionHook;
  /** (Re)schedules one `elapsed` rule of one feature on the current config; returns its `due_at`, or undefined when it has none (the row is removed). */
  scheduleFor(feature: FeatureId, rule: Key): Instant | undefined;
  /** Creates the missing rows of the `schedule` rules of the current config; returns how many it added. */
  syncSchedules(): number;
  /**
   * After a deploy: schedules `rule` (or every elapsed rule) for all live features of its types and removes rows of
   * rules the config no longer has. One pass over the features of those types, never per interaction.
   */
  rebuild(rule?: Key): number;
  /** Fires what is due at `now`. */
  /** `limit` rows per tick; `sweepCap` Objekte per idle sweep per tick (default 1000, v3). */
  tick(now: Instant, limit?: number, sweepCap?: number): TickResult;
}

export type CreateTimers = (db: Db, deps: TimersDeps) => Timers;
