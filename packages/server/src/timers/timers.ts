/** Server timers: scheduling in the run transaction, firing on a tick. Contract: contract.ts. */
import type { CompiledConfig, FeatureId, FeatureState, Instant, Key } from '@ueberblick/core';
import {
  elapsedDueAt,
  scheduleCatchUp,
  scheduleDueAfter,
  timeRules,
  type ElapsedRule,
  type ScheduleRule,
} from '@ueberblick/core/rules/timing';
import type { Db } from '../db/driver';
import {
  ConfigVersionGone,
  createFacts,
  inverseRelations,
  type ServerFacts,
  type TransactionContext,
} from '../store';
import { evalContext, fireRule } from './fire';
import {
  parseSweep,
  sweepBatch,
  sweepSubject,
  SWEEP_BUDGET_MS,
  SWEEP_PREFIX,
  SWEEP_TICK_CAP,
  type SweepCounts,
} from './sweep';
import { SCHEDULE_SUBJECT, type Timers, type TimersDeps, type TickResult } from './contract';
import { isServed, RESERVED_VERSION, servedSql } from '@ueberblick/core';

const DEFAULT_TICK_LIMIT = 500;
/** Observation properties that create, restore or delete a feature (docs/04). */
const LIFECYCLE = ['$type', '$lifecycle'] as const;

interface DueRow {
  feature_id: string;
  rule: string;
  due_at: string;
  config_version: number | null;
}

interface RowVersion {
  feature_id: string;
  rule: string;
  v: number;
}

const iso = (ms: number): string => new Date(ms).toISOString();

export function createTimers(db: Db, deps: TimersDeps): Timers {
  const upsert = db.prepare(
    'INSERT INTO timers (feature_id, rule, due_at, config_version) VALUES (?, ?, ?, ?) ON CONFLICT (feature_id, rule) DO UPDATE SET due_at = excluded.due_at, config_version = excluded.config_version',
  );
  const remove = db.prepare('DELETE FROM timers WHERE feature_id = ? AND rule = ?');
  const removeAll = db.prepare('DELETE FROM timers WHERE feature_id = ?');
  const claim = db.prepare('DELETE FROM timers WHERE feature_id = ? AND rule = ? AND due_at = ?');
  const due = db.prepare<DueRow>(
    'SELECT feature_id, rule, due_at, config_version FROM timers WHERE due_at <= ? ORDER BY due_at, feature_id, rule LIMIT ?',
  );
  const has = db.prepare('SELECT 1 FROM timers WHERE feature_id = ? AND rule = ?');
  /** Every row with the version of its subject: the pin, else the deployed one (a `schedule` row has no feature). */
  const allWithVersion = db.prepare<RowVersion>(
    'SELECT t.feature_id, t.rule, coalesce(f.pinned_version, ?) AS v FROM timers t LEFT JOIN features f ON f.id = t.feature_id',
  );
  const pins = db.prepare<{ v: number }>(
    'SELECT DISTINCT pinned_version AS v FROM features WHERE pinned_version IS NOT NULL',
  );
  /** The served features of one type whose effective version is `?` (the second `?` is the deployed version). */
  const idsOfTypeAt = db.prepare<{ id: string }>(
    `SELECT id FROM features WHERE type = ? AND ${servedSql('lifecycle')} AND coalesce(pinned_version, ?) = ?`,
  );

  /** Rules already warned about, per config version: one line per rule per version. */
  const warned = new Map<number, Set<string>>();
  const warnDropped = (version: number, rule: string): void => {
    let rules = warned.get(version);
    if (rules === undefined) warned.set(version, (rules = new Set()));
    if (rules.has(rule)) return;
    rules.add(rule);
    deps.log.log('timer.dropped', { ruleId: rule, code: 'schedule_never_runs' });
  };

  const accessOf = new WeakMap<CompiledConfig, ServerFacts>();
  const access = (config: CompiledConfig): ServerFacts => {
    let a = accessOf.get(config);
    if (a === undefined) accessOf.set(config, (a = createFacts(db, inverseRelations(config))));
    return a;
  };

  /** The config of a stored version; a pin whose version is gone is an error, never a fallback (R11). */
  const configAt = (version: number, memo?: Map<number, CompiledConfig>): CompiledConfig => {
    let config = memo?.get(version);
    if (config === undefined) {
      config = deps.versions.configFor(version);
      if (config === undefined) throw new ConfigVersionGone(version);
      memo?.set(version, config);
    }
    return config;
  };

  /**
   * Writes or removes the `(feature, rule)` row from the feature's current state, under `version` (the subject's
   * effective version, the one `config` belongs to); returns the new `due_at`.
   */
  function schedule(
    config: CompiledConfig,
    version: number,
    now: Instant,
    state: FeatureState,
    rule: ElapsedRule,
  ): Instant | undefined {
    let at: Instant | undefined;
    if (isServed(state.lifecycle) && rule.types.includes(state.type)) {
      const ctx = evalContext(
        config,
        access(config),
        deps.geo,
        now,
        new Map([['self', { $feature: state.id }]]),
      );
      at = elapsedDueAt(rule, ctx);
    }
    if (at === undefined) remove.run(state.id, rule.key);
    else upsert.run(state.id, rule.key, at, version);
    return at;
  }

  const hook = (ctx: TransactionContext): void => {
    const deployed = deps.versions.deployed();
    if (deployed === undefined) return;
    const now = deps.clock.now();
    const memo = new Map<number, CompiledConfig>([[deployed.version, ctx.config]]);
    const rulesOf = new Map<number, ReturnType<typeof timeRules>>();
    const wrote = new Map<string, Set<string>>();
    for (const p of ctx.runs)
      for (const o of p.observations) {
        const set = wrote.get(o.featureId) ?? new Set<string>();
        wrote.set(o.featureId, set.add(o.property));
      }
    for (const f of ctx.features) {
      if (!isServed(f.lifecycle)) {
        removeAll.run(f.id);
        continue;
      }
      const version = f.pinnedVersion ?? deployed.version;
      const config = configAt(version, memo);
      let rules = rulesOf.get(version);
      if (rules === undefined) rulesOf.set(version, (rules = timeRules(config)));
      const touched = wrote.get(f.id);
      // A pin or an unpin moves the feature to another version: its rows are rebuilt under the new one, and a rule the
      // new version lacks loses its row.
      const moved = touched?.has(RESERVED_VERSION) === true;
      if (moved) removeAll.run(f.id);
      for (const rule of rules.byType.get(f.type) ?? []) {
        const relevant =
          moved ||
          touched === undefined ||
          rule.reads === undefined ||
          LIFECYCLE.some((p) => touched.has(p)) ||
          [...rule.reads].some((p) => touched.has(p));
        if (relevant) schedule(config, version, now, f, rule);
      }
    }
  };

  const sweeping = db.prepare('SELECT 1 FROM timers WHERE rule = ? AND substr(feature_id, 1, ?) = ?');

  /** One batch of an idle sweep (`sweep.ts`); a sweep that is not done leaves its resume row, due now. */
  function sweepOne(
    deployed: { readonly version: number; readonly config: CompiledConfig },
    rule: ScheduleRule | undefined,
    at: Instant,
    cursor: string,
    now: Instant,
    cap: number,
  ): SweepCounts {
    if (rule === undefined) return { fired: 0, refused: 0, skipped: 1, failed: 0 };
    const facts = access(deployed.config);
    const started = Date.parse(deps.clock.now());
    const { counts, last } = sweepBatch(
      {
        db,
        facts,
        config: deployed.config,
        version: deployed.version,
        ctxOf: (t, vars) => evalContext(deployed.config, facts, deps.geo, t, vars),
        submit: deps.submit,
        runId: deps.ids.runId,
      },
      rule,
      at,
      cursor,
      now,
      { cap, budgetMs: SWEEP_BUDGET_MS, elapsedMs: () => Date.parse(deps.clock.now()) - started },
    );
    if (last !== undefined) upsert.run(sweepSubject(at, last), rule.key, now, deployed.version);
    return counts;
  }

  /** Fires one claimed row under the version of its subject (a `schedule` row: the deployed one). */
  function fireOne(
    row: DueRow,
    now: Instant,
    deployed: { readonly version: number; readonly config: CompiledConfig },
    memo: Map<number, CompiledConfig>,
    sweepCap: number,
  ): 'fired' | 'refused' | 'skipped' | SweepCounts {
    const resume = parseSweep(row.feature_id);
    if (resume !== undefined)
      return sweepOne(
        deployed,
        timeRules(deployed.config).schedules.get(row.rule),
        resume.at,
        resume.cursor,
        now,
        sweepCap,
      );
    const isSchedule = row.feature_id === SCHEDULE_SUBJECT;
    let version = deployed.version;
    let config = deployed.config;
    let subject: FeatureId | undefined;
    if (isSchedule) {
      const scheduled = timeRules(config).schedules.get(row.rule);
      if (scheduled === undefined) return 'skipped';
      const catchUp = scheduleCatchUp(scheduled, row.due_at, now);
      if (catchUp.next.ok) upsert.run(SCHEDULE_SUBJECT, row.rule, catchUp.next.at, version);
      else warnDropped(version, scheduled.key);
      if (!catchUp.fire) return 'skipped';
      // An idle sweep visits the Objekte instead of firing once; one sweep at a time per rule.
      if (scheduled.idle !== undefined)
        return sweeping.get(row.rule, SWEEP_PREFIX.length, SWEEP_PREFIX) === undefined
          ? sweepOne(deployed, scheduled, now, '', now, sweepCap)
          : 'skipped';
    } else {
      const state = access(config).feature(row.feature_id as FeatureId);
      if (state === undefined || !isServed(state.lifecycle)) return 'skipped';
      version = state.pinnedVersion ?? deployed.version;
      config = configAt(version, memo);
      const elapsed = timeRules(config).elapsed.get(row.rule);
      if (elapsed === undefined) return 'skipped';
      // The row was scheduled under another version (a deploy or a pin in between): reschedule, never fire stale.
      if (row.config_version !== version) {
        schedule(config, version, now, state, elapsed);
        return 'skipped';
      }
      subject = state.id;
    }
    const facts = access(config);
    const fired = fireRule(config, version, row.rule, subject, (vars) =>
      evalContext(config, facts, deps.geo, now, vars),
    );
    if (!fired.fire) return 'skipped';
    // The run's time is the timer's clock, so a stage a timer writes has a time for `changed_at` (WP-389, A-038).
    const result = deps.submit({ ...fired.run, id: deps.ids.runId(), clientTime: now });
    return result.outcome === 'accepted' ? 'fired' : 'refused';
  }

  return {
    hook: Object.assign(hook, { hookName: 'timers' }),

    scheduleFor(feature: FeatureId, rule: Key): Instant | undefined {
      const cur = deps.versions.deployed();
      const state = cur && access(cur.config).feature(feature);
      if (cur === undefined || state === undefined) {
        remove.run(feature, rule);
        return undefined;
      }
      const version = state.pinnedVersion ?? cur.version;
      const config = configAt(version);
      const r = timeRules(config).elapsed.get(rule);
      if (r === undefined) {
        remove.run(feature, rule);
        return undefined;
      }
      return db.transaction(() => schedule(config, version, deps.clock.now(), state, r));
    },

    syncSchedules(): number {
      const cur = deps.versions.deployed();
      if (cur === undefined) return 0;
      const now = deps.clock.now();
      let added = 0;
      db.transaction(() => {
        for (const rule of timeRules(cur.config).schedules.values()) {
          if (has.get(SCHEDULE_SUBJECT, rule.key) !== undefined) continue;
          const next = scheduleDueAfter(rule, now);
          if (!next.ok) {
            warnDropped(cur.version, rule.key);
            continue;
          }
          upsert.run(SCHEDULE_SUBJECT, rule.key, next.at, cur.version);
          added++;
        }
      });
      return added;
    },

    rebuild(only?: Key): number {
      const cur = deps.versions.deployed();
      if (cur === undefined) return 0;
      const memo = new Map<number, CompiledConfig>([[cur.version, cur.config]]);
      const now = deps.clock.now();
      let scheduled = 0;
      db.transaction(() => {
        // The live versions: the deployed one and every pin. A handful, never per feature (R14).
        const live = new Set<number>([cur.version, ...pins.all().map((r) => r.v)]);
        if (only === undefined)
          for (const t of allWithVersion.all(cur.version)) {
            const rules = timeRules(configAt(t.v, memo));
            const kept =
              t.feature_id === SCHEDULE_SUBJECT || t.feature_id.startsWith(SWEEP_PREFIX)
                ? timeRules(cur.config).schedules.has(t.rule)
                : rules.elapsed.has(t.rule);
            if (!kept) remove.run(t.feature_id, t.rule);
          }
        for (const version of live) {
          const config = configAt(version, memo);
          const elapsed = timeRules(config).elapsed;
          const list = only === undefined ? [...elapsed.values()] : [elapsed.get(only)];
          const facts = access(config);
          for (const rule of list) {
            if (rule === undefined) continue;
            for (const type of rule.types)
              for (const { id } of idsOfTypeAt.all(type, cur.version, version)) {
                const state = facts.feature(id as FeatureId);
                if (state !== undefined && schedule(config, version, now, state, rule) !== undefined)
                  scheduled++;
              }
          }
        }
      });
      return scheduled;
    },

    tick(now: Instant, limit = DEFAULT_TICK_LIMIT, sweepCap = SWEEP_TICK_CAP): TickResult {
      const cur = deps.versions.deployed();
      const out = { fired: 0, refused: 0, skipped: 0, failed: 0 };
      if (cur === undefined) return out;
      const at = iso(Date.parse(now));
      // One config per version per tick (through the shared cache), however many rows are due.
      const memo = new Map<number, CompiledConfig>([[cur.version, cur.config]]);
      for (const row of due.all(at, limit)) {
        try {
          const outcome = db.transaction(() => {
            if (claim.run(row.feature_id, row.rule, row.due_at).changes === 0) return undefined;
            return fireOne(row, at, cur, memo, sweepCap);
          });
          if (typeof outcome === 'object') {
            for (const k of Object.keys(out) as (keyof SweepCounts)[]) out[k] += outcome[k];
          } else if (outcome !== undefined)
            out[outcome === 'fired' ? 'fired' : outcome === 'refused' ? 'refused' : 'skipped']++;
        } catch {
          out.failed++;
        }
      }
      return out;
    },
  };
}
