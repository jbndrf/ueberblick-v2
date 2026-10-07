/**
 * The time-based automatic actions of a config (`elapsed` and `schedule` entries of `tasks.<t>.auto`), resolved once per config, and the
 * due time of an elapsed rule. Serves the server timers, the builder simulator ("advance time") and later the
 * device (H2 dispatch, H5 command centre: "what fires when"). Pure: time arrives in the `EvalContext` (R2).
 *
 * A `CompiledConfig` that did not come from `compile` and breaks its guarantees (a bad cron, a missing `elapsed.from`
 * expression) makes `timeRules` throw an invariant error naming the automatic action id (`<task>.<name>`).
 *
 * The `from`, `after` and `offset` expressions are checked and stored by compile under
 * `tasks.<task>.auto.<name>.elapsed.<name>`; nothing here parses.
 */
import type { CompiledConfig, CompiledExpr } from '../../schema/compile/contract';
import { autoPath } from '../../schema/compile/autos';
import type { EvalContext } from '../../expr';
import { evaluate } from '../../expr/evaluate';
import { shift, sumDur, toDur, type Dur } from '../../expr/evaluate/duration';
import { changedAtProperties } from '../../expr/functions/history';
import { parseInstant } from '../../expr/functions/support';
import type { Instant } from '../../model';
import { nextAfter, parseCron, type Cron, type CronError } from './cron';

export interface ElapsedRule {
  readonly key: string;
  /** The feature type(s) `self` is: the type(s) the rule's task is offered on. */
  readonly types: readonly string[];
  /** The timestamp the timer follows. */
  readonly from: CompiledExpr;
  /** Durations added to `from`, in the order after, offset. */
  readonly shifts: readonly CompiledExpr[];
  /** Properties of `self` the expressions read, or undefined when they read `self` as a whole. */
  readonly reads: ReadonlySet<string> | undefined;
}

export interface ScheduleRule {
  readonly key: string;
  readonly cron: Cron;
  /** The feature type(s) the rule's task is offered on: what an idle sweep visits. */
  readonly types: readonly string[];
  /**
   * `on.idle`, a duration: set, the schedule is a sweep that fires per Objekt idle at least this long (`idle.ts`);
   * absent, it fires once with no subject.
   */
  readonly idle?: CompiledExpr;
}

export interface TimeRules {
  /** Elapsed rules by the feature type they apply to. */
  readonly byType: ReadonlyMap<string, readonly ElapsedRule[]>;
  readonly elapsed: ReadonlyMap<string, ElapsedRule>;
  readonly schedules: ReadonlyMap<string, ScheduleRule>;
}

const cache = new WeakMap<CompiledConfig, TimeRules>();

/** The types a rule's task is offered on. `tasksByType` also lists `$map`/`$none`; those are no feature type. */
function typesOf(config: CompiledConfig, task: string): string[] {
  const out: string[] = [];
  for (const [type, tasks] of config.tasksByType)
    if (config.file.types?.[type] !== undefined && tasks.includes(task)) out.push(type);
  return out;
}

const SELF_PROPERTY = /\bself\.([a-z][a-z0-9_]*)/g;
const SELF_WHOLE = /\bself\b(?!\.)/;

const cronMessage = (e: CronError, source: string): string =>
  `not a cron expression (${e.message}): ${source}`;

export function timeRules(config: CompiledConfig): TimeRules {
  const hit = cache.get(config);
  if (hit !== undefined) return hit;
  const byType = new Map<string, ElapsedRule[]>();
  const elapsed = new Map<string, ElapsedRule>();
  const schedules = new Map<string, ScheduleRule>();
  for (const [key, auto] of config.autos) {
    // Only the timings `elapsed` and `schedule` run on the clock; the others are judged by the planner after a run.
    if (auto.kind === 'schedule') {
      const cronSource = auto.entry.schedule as string;
      const parsed = parseCron(cronSource);
      const idle = config.expressions.get(autoPath(auto, 'idle'));
      if (parsed.ok)
        schedules.set(key, {
          key,
          cron: parsed.cron,
          types: typesOf(config, auto.task),
          ...(idle === undefined ? {} : { idle }),
        });
      else throw new Error(`timeRules: automatic action '${key}': ${cronMessage(parsed.error, cronSource)}`);
      continue;
    }
    if (auto.kind !== 'elapsed') continue;
    const at = (name: string): CompiledExpr | undefined =>
      config.expressions.get(autoPath(auto, 'elapsed', name));
    const from = at('from');
    if (from === undefined) {
      throw new Error(`timeRules: automatic action '${key}': elapsed.from is not in the compiled config`);
    }
    const shifts = [at('after'), at('offset')].filter((e): e is CompiledExpr => e !== undefined);
    const sources = [from, ...shifts].map((e) => e.source).join(' ');
    const reads = SELF_WHOLE.test(sources)
      ? undefined
      : new Set([
          ...[...sources.matchAll(SELF_PROPERTY)].map((m) => m[1] as string),
          // `changed_at('stage')` reads the property `stage` too: its write moves the due time (WP-389). From the AST.
          ...[from, ...shifts].flatMap((e) => [...changedAtProperties(e.typed.ast)]),
        ]);
    const r: ElapsedRule = { key, types: typesOf(config, auto.task), from, shifts, reads };
    elapsed.set(key, r);
    for (const t of r.types) byType.set(t, [...(byType.get(t) ?? []), r]);
  }
  const rules: TimeRules = { byType, elapsed, schedules };
  cache.set(config, rules);
  return rules;
}

/** First `schedule` time strictly after `from` (ISO instant), or undefined when the cron never matches. */
export const nextRun = (rule: ScheduleRule, from: Instant): Instant | undefined => nextAfter(rule.cron, from);

/**
 * When `rule` is due for the subject in `ctx`: `from + after + offset`. `ctx.vars` holds `self` (and `inputs`,
 * `actor` as the expressions need them). Undefined while `from` has no value, or when an expression does not
 * evaluate to a timestamp or duration (evaluation is total: no throw).
 */
export function elapsedDueAt(rule: ElapsedRule, ctx: EvalContext): Instant | undefined {
  const from = evaluate(rule.from.typed, ctx);
  if (!from.ok || typeof from.value !== 'string' || parseInstant(from.value) === undefined) return undefined;
  let total: Dur = { months: 0, ms: 0 };
  for (const e of rule.shifts) {
    const r = evaluate(e.typed, ctx);
    const d = r.ok ? toDur(r.value) : undefined;
    if (d === undefined) return undefined;
    total = sumDur(total, d);
  }
  try {
    return shift(from.value, total);
  } catch {
    return undefined;
  }
}
