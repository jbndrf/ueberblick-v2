/** Combining `&&`/`||` runs: a balanced tree, and the collapse of equality runs to `IN` (H6). */
import type { BinaryNode, Expr } from '../ast';
import type { Ty } from '../check/types';
import { bind, cat, type Frag, type SqlParam } from './frag';

/** Fragments that are `x == constant` (keyed by identity), so a run of them can collapse to `IN`. */
export type Equalities = WeakMap<Frag, { readonly x: Frag; readonly v: SqlParam }>;

export function balanced(items: readonly Frag[], word: 'AND' | 'OR'): Frag {
  if (items.length === 1) return items[0] as Frag;
  const mid = items.length >> 1;
  return cat('(', balanced(items.slice(0, mid), word), ` ${word} `, balanced(items.slice(mid), word), ')');
}

interface Group {
  readonly x: Frag;
  readonly values: SqlParam[];
  readonly first: Frag;
}
const isGroup = (o: Frag | Group): o is Group => 'values' in o;

/** `x IN (items)` that is false (not null) for a null `x`, as `x == c` is in the rule language. */
export function inListOf(x: Frag, items: readonly Frag[]): Frag {
  const list = cat(...items.flatMap((f, i) => (i === 0 ? [f] : [', ', f])));
  return cat('(', x, ' IS NOT NULL AND ', x, ' IN (', list, '))');
}
const inList = (x: Frag, values: readonly SqlParam[]): Frag => inListOf(x, values.map(bind));

/**
 * A run of `x == c1 || x == c2 || ...` on one stored value becomes one `x IN (?, ...)` (H6: OR-lists from QGIS),
 * placed where its first term was. Only string and number constants collapse; `IS` and `IN` order them alike.
 */
export function collapseEquals(items: readonly Frag[], equals: Equalities): Frag[] {
  const out: (Frag | Group)[] = [];
  const groups = new Map<string, Group>();
  for (const item of items) {
    const eq = equals.get(item);
    if (eq === undefined) {
      out.push(item);
      continue;
    }
    const key = `${eq.x.sql}\u0000${JSON.stringify(eq.x.params)}`;
    const g = groups.get(key);
    if (g === undefined) {
      const created: Group = { x: eq.x, values: [eq.v], first: item };
      groups.set(key, created);
      out.push(created);
    } else g.values.push(eq.v);
  }
  return out.map((o) => (isGroup(o) ? (o.values.length === 1 ? o.first : inList(o.x, o.values)) : o));
}

/** `ts + months(n)` or `ts - months(n)`: the argument `n`, when this is such a node (`left` is the type of the left side). */
export function monthsArg(node: BinaryNode, left: Ty): Expr | undefined {
  const r = node.right;
  if ((node.op !== '+' && node.op !== '-') || r.kind !== 'call' || r.name !== 'months') return undefined;
  if (r.target !== undefined || r.args.length !== 1 || left.kind !== 'timestamp') return undefined;
  return r.args[0];
}

/** The calendar-month clamp is an application function, not an SQLite modifier (SQL_APP_FUNCTIONS). */
export const addMonthsFrag = (ts: Frag, n: Frag, op: string): Frag =>
  cat('ub_add_months(', ts, ', ', op === '-' ? cat('-(', n, ')') : n, ')');
