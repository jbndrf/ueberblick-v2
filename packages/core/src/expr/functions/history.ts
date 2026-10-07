/**
 * History of the current feature (`self`): `last`, `changed`, `count`, `previous`. `check` validates the
 * property name and the count (device limit 10), so `sigs` is empty. On the device the store holds only
 * the last 10 values per property (`FeatureAccess.history` decides what exists).
 */
import type { Expr } from '../ast';
import type { RecordedObservation } from '../../model';
import { children } from '../parse/walk';
import type { EvalContext, EvalValue } from '../contract';
import { bind, cat, unsupported, type Frag } from '../sql/frag';
import { defineFunction, type SqlCall } from './define';
import { deepEqual, fail, isFeatureRef } from './support';

/** The most `count()` asks for. */
export const HISTORY_COUNT_LIMIT = 10_000;

function history(ctx: EvalContext, property: unknown, limit: number): readonly RecordedObservation[] {
  const self = ctx.vars.get('self');
  if (!isFeatureRef(self)) return fail("history functions need a 'self' feature");
  if (typeof property !== 'string') return fail('the property name must be a string');
  return ctx.features.history(self.$feature, property, limit);
}

/** `FROM observations` of `self` for the property named by the first argument (a constant). */
function observations(call: SqlCall): Frag {
  const name = call.args[0]?.literal;
  if (typeof name !== 'string') return unsupported('history of a computed property name');
  return cat('FROM observations o WHERE o.feature_id = ', `${call.self}.id AND o.property = `, bind(name));
}
/** The n-th newest value (0 = current) of the property. */
const nth = (call: SqlCall, n: number): Frag =>
  cat(
    "(SELECT json_extract(o.result, '$') ",
    observations(call),
    ` ORDER BY o.seq DESC LIMIT 1 OFFSET ${n})`,
  );

export const last = defineFunction({
  name: 'last',
  sigs: [],
  sql: () => unsupported('last() returns a list'),
  evaluate: ({ args }, { ctx }) => {
    const n = args[1];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) return fail('the count must be at least 1');
    return history(ctx, args[0], n).map((o) => o.result as EvalValue);
  },
});

/** True when the two newest values differ, or when there is only one (from nothing to a value). */
export const changed = defineFunction({
  name: 'changed',
  sigs: [],
  sql: (call) =>
    cat(
      '(CASE (SELECT count(*) FROM (SELECT 1 ',
      observations(call),
      ' LIMIT 2)) WHEN 0 THEN 0 WHEN 1 THEN 1 ELSE (',
      nth(call, 0),
      ' IS NOT ',
      nth(call, 1),
      ') END)',
    ),
  evaluate: ({ args }, { ctx }) => {
    const [a, b] = history(ctx, args[0], 2);
    if (a === undefined) return false;
    return b === undefined || !deepEqual(a.result, b.result);
  },
});

export const count = defineFunction({
  name: 'count',
  sigs: [],
  sql: (call) => cat('MIN(', bind(HISTORY_COUNT_LIMIT), ', (SELECT count(*) ', observations(call), '))'),
  evaluate: ({ args }, { ctx }) => history(ctx, args[0], HISTORY_COUNT_LIMIT).length,
});

/** The value before the newest one; null when there is none. */
export const previous = defineFunction({
  name: 'previous',
  sigs: [],
  sql: (call) => nth(call, 1),
  evaluate: ({ args }, { ctx }) => {
    const p = history(ctx, args[0], 2)[1];
    return p === undefined ? null : p.result;
  },
});

/**
 * When the property last got a value (WP-389, A-038): the time (`phenomenonTime`, the run's time, never a clock) of its
 * newest observation; null while it has none or the run carried no time. Generic: the stage is just a property, so
 * `changed_at('stage') + days(3)` is "three days after the Objekt entered its stage". Reads the history port,
 * so fold keeps no extra state.
 */
export const changedAt = defineFunction({
  name: 'changed_at',
  sigs: [],
  sql: (call) => cat('(SELECT o.phenomenon_time ', observations(call), ' ORDER BY o.seq DESC LIMIT 1)'),
  evaluate: ({ args }, { ctx }) => history(ctx, args[0], 1)[0]?.phenomenonTime ?? null,
});

export const HISTORY_FUNCTION_DEFS = [last, changed, count, previous, changedAt];

/** Names of the history functions of the current feature: the first argument names a property of `self`. */
export const HISTORY_FUNCTIONS: readonly string[] = HISTORY_FUNCTION_DEFS.map((f) => f.name);

/**
 * The properties of `self` an expression names in `changed_at('prop')` (either quote style, at any depth), read from
 * the AST, never from the source text. A rule that timers follow re-schedules when one of them is written.
 */
export function changedAtProperties(ast: Expr): ReadonlySet<string> {
  const out = new Set<string>();
  const stack: Expr[] = [ast];
  while (stack.length > 0) {
    const n = stack.pop() as Expr;
    if (n.kind === 'call' && n.target === undefined && n.name === changedAt.name) {
      const first = n.args[0];
      if (first?.kind === 'literal' && typeof first.value === 'string') out.add(first.value);
    }
    for (const c of children(n)) stack.push(c);
  }
  return out;
}
