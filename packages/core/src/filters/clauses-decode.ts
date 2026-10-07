/**
 * Reads a saved view back into builder rows (WP-665): the inverse of `clausesToFilter`. A view written by the builder
 * round-trips; a view written by hand or by an assistant (H4) opens as far as its terms fit a row, and every other
 * term is kept as a `rule` row, so saving the view never loses a term. Pure: the AST comes from `core.expr`.
 */
import { PARSE_LIMITS, type Expr } from '../expr/ast';
import { print } from '../expr/explain/print';
import { parse } from '../expr/parse';
import { processesOf } from '../process';
import { type PropertyTypeKey } from '../registry';
import {
  type FilterWhenField,
  FILTER_CREATED_BY_SYSTEM,
  FILTER_EDITOR_BY_TYPE,
  FILTER_WHEN_SYSTEM,
} from '../registry/filter';
import type { CompiledConfig } from '../schema/compile/contract';
import type { FilterSource } from './contract';
import { isTimeOfDay, previousDay, type Clause, type WhenClause } from './clauses';

const CMP: ReadonlySet<string> = new Set(['>=', '<=', '<', '>']);

/** One recognised term of an AND chain. */
type Piece =
  | { readonly t: 'text'; readonly key: string; readonly text: string }
  | { readonly t: 'in'; readonly key: string; readonly values: readonly string[] }
  | { readonly t: 'num'; readonly key: string; readonly op: string; readonly n: number }
  | { readonly t: 'day'; readonly key: string; readonly op: string; readonly day: string }
  | { readonly t: 'age'; readonly key: string; readonly op: string; readonly days: number }
  | { readonly t: 'bool'; readonly key: string; readonly value: boolean }
  | { readonly t: 'me'; readonly key: string }
  | { readonly t: 'null'; readonly key: string; readonly op: string }
  | { readonly t: 'str'; readonly key: string; readonly op: string; readonly text: string };

const selfKey = (e: Expr): string | undefined =>
  e.kind === 'member' && e.object.kind === 'ident' && e.object.name === 'self' ? e.field : undefined;
const strLit = (e: Expr): string | undefined =>
  e.kind === 'literal' && e.type === 'string' ? (e.value as string) : undefined;

function numLit(e: Expr): number | undefined {
  if (e.kind === 'literal' && (e.type === 'int' || e.type === 'double')) return e.value as number;
  if (e.kind === 'unary' && e.op === '-') {
    const n = numLit(e.operand);
    return n === undefined ? undefined : -n;
  }
  return undefined;
}

function strList(e: Expr): readonly string[] | undefined {
  if (e.kind !== 'list') return undefined;
  const out: string[] = [];
  for (const x of e.elements) {
    const s = strLit(x);
    if (s === undefined) return undefined;
    out.push(s);
  }
  return out;
}

/** `date("2026-10-01")` */
function dayOf(e: Expr): string | undefined {
  if (e.kind !== 'call' || e.name !== 'date' || e.target !== undefined || e.args.length !== 1)
    return undefined;
  const s = strLit(e.args[0] as Expr);
  return s !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

/** `now - days(7)` */
function ageOf(e: Expr): number | undefined {
  if (e.kind !== 'binary' || e.op !== '-' || e.left.kind !== 'ident' || e.left.name !== 'now')
    return undefined;
  const r = e.right;
  if (r.kind !== 'call' || r.name !== 'days' || r.target !== undefined || r.args.length !== 1)
    return undefined;
  return numLit(r.args[0] as Expr);
}

function recognise(e: Expr): Piece | undefined {
  if (e.kind === 'call' && e.name === 'contains' && e.target !== undefined && e.args.length === 1) {
    const key = selfKey(e.target);
    const text = strLit(e.args[0] as Expr);
    return key === undefined || text === undefined ? undefined : { t: 'text', key, text };
  }
  if (e.kind === 'binary' && e.op === 'in') {
    const key = selfKey(e.left);
    const values = strList(e.right);
    return key === undefined || values === undefined ? undefined : { t: 'in', key, values };
  }
  if (e.kind === 'comprehension' && e.macro === 'exists') {
    const b = e.body;
    const values = strList(e.range);
    if (values === undefined || b.kind !== 'binary' || b.op !== 'in') return undefined;
    const key = selfKey(b.right);
    return key === undefined || b.left.kind !== 'ident' || b.left.name !== e.variable
      ? undefined
      : { t: 'in', key, values };
  }
  if (e.kind === 'binary' && (e.op === '==' || e.op === '!=')) {
    const key = selfKey(e.left);
    if (key === undefined) return undefined;
    if (e.right.kind === 'literal' && e.right.type === 'null') return { t: 'null', key, op: e.op };
    if (e.op === '==' && e.right.kind === 'literal' && e.right.type === 'bool')
      return { t: 'bool', key, value: e.right.value as boolean };
    const r = e.right;
    if (
      e.op === '==' &&
      r.kind === 'member' &&
      r.field === 'id' &&
      r.object.kind === 'ident' &&
      r.object.name === 'actor'
    )
      return { t: 'me', key };
  }
  if (e.kind === 'binary' && CMP.has(e.op)) {
    const key = selfKey(e.left);
    if (key === undefined) return undefined;
    const text = strLit(e.right);
    if (text !== undefined) return { t: 'str', key, op: e.op, text };
    const n = numLit(e.right);
    if (n !== undefined) return { t: 'num', key, op: e.op, n };
    const day = dayOf(e.right);
    if (day !== undefined) return { t: 'day', key, op: e.op, day };
    const days = ageOf(e.right);
    if (days !== undefined) return { t: 'age', key, op: e.op, days };
  }
  return undefined;
}

/** The terms of an AND chain, left to right. */
function terms(root: Expr): readonly Expr[] {
  const out: Expr[] = [];
  const stack: Expr[] = [root];
  while (stack.length > 0) {
    const e = stack.pop() as Expr;
    if (e.kind === 'binary' && e.op === '&&') stack.push(e.right, e.left);
    else out.push(e);
  }
  return out;
}

const WHEN_OF_SYSTEM = new Map<string, FilterWhenField>(
  (Object.entries(FILTER_WHEN_SYSTEM) as [FilterWhenField, string][]).map(([f, s]) => [s, f]),
);

/** A row and the source of the terms it was read from (a stray `when` / `created_by` row falls back to `rule`). */
interface Entry {
  readonly clause: Clause;
  readonly sources: readonly string[];
}

function typeEntries(config: CompiledConfig, type: string, source: string): readonly Entry[] {
  const parsed = parse(source, PARSE_LIMITS.untrusted);
  if (!parsed.ok) return [{ clause: { kind: 'rule', type, source }, sources: [source] }];
  const def = config.file.types?.[type];
  const stageKey = def === undefined ? undefined : processesOf(def)[0]?.property;
  const entries: Entry[] = [];
  const slots = new Map<string, number>();
  const stray = (src: string): void =>
    void entries.push({ clause: { kind: 'rule', type, source: src }, sources: [src] });
  /** Adds a row, or fills the open end of the row at `id`; a taken end makes the term a stray `rule`. */
  const put = (
    id: string | undefined,
    src: string,
    make: Clause,
    fill?: (c: Clause) => Clause | undefined,
  ): void => {
    const at = id === undefined ? undefined : slots.get(id);
    if (at === undefined) {
      if (id !== undefined) slots.set(id, entries.length);
      entries.push({ clause: make, sources: [src] });
      return;
    }
    const cur = entries[at] as Entry;
    const next = fill?.(cur.clause);
    if (next === undefined) stray(src);
    else entries[at] = { clause: next, sources: [...cur.sources, src] };
  };

  for (const term of terms(parsed.ast)) {
    const src = print(term);
    const p = recognise(term);
    if (p === undefined) {
      stray(src);
      continue;
    }
    if (p.key === FILTER_CREATED_BY_SYSTEM) {
      if (p.t === 'in') put(undefined, src, { kind: 'created_by', values: p.values });
      else stray(src);
      continue;
    }
    const when = WHEN_OF_SYSTEM.get(p.key);
    if (when !== undefined) {
      const base: WhenClause = { kind: 'when', field: when, mode: 'between', days: 7, from: null, to: null };
      if (p.t === 'age' && (p.op === '<' || p.op === '>') && p.days > 0)
        put(undefined, src, { ...base, mode: p.op === '<' ? 'older' : 'newer', days: p.days });
      else if (p.t === 'day' && (p.op === '>=' || p.op === '<')) {
        const lo = p.op === '>=';
        const patch = lo ? { from: p.day } : { to: previousDay(p.day) };
        put(`w:${when}`, src, { ...base, ...patch }, (c) =>
          c.kind === 'when' && c.mode === 'between' && (lo ? c.from === null : c.to === null)
            ? { ...c, ...patch }
            : undefined,
        );
      } else stray(src);
      continue;
    }
    const pt: PropertyTypeKey | undefined = def?.properties[p.key]?.type;
    const editor = pt === undefined ? undefined : FILTER_EDITOR_BY_TYPE[pt];
    if (pt === undefined || editor === undefined) {
      stray(src);
      continue;
    }
    const f = { kind: 'field' as const, type, key: p.key, propType: pt };
    const id = `f:${p.key}`;
    if (p.t === 'text' && editor === 'text') put(undefined, src, { ...f, editor, text: p.text });
    else if (p.t === 'in' && editor === 'choice')
      put(
        undefined,
        src,
        p.key === stageKey ? { kind: 'stage', type, values: p.values } : { ...f, editor, values: p.values },
      );
    else if (p.t === 'num' && editor === 'number' && (p.op === '>=' || p.op === '<=')) {
      const lo = p.op === '>=';
      const patch = lo ? { min: p.n } : { max: p.n };
      put(id, src, { ...f, editor, min: null, max: null, ...patch }, (c) =>
        c.kind === 'field' && c.editor === 'number' && (lo ? c.min === null : c.max === null)
          ? { ...c, ...patch }
          : undefined,
      );
    } else if (p.t === 'bool' && editor === 'boolean')
      put(id, src, { ...f, editor, value: p.value }, () => undefined);
    else if (p.t === 'me' && editor === 'participant')
      put(id, src, { ...f, editor, me: true }, () => undefined);
    else if (p.t === 'null' && editor === 'presence' && (p.op === '==' || p.op === '!='))
      put(id, src, { ...f, editor, state: p.op === '==' ? 'empty' : 'filled' }, () => undefined);
    else if (p.t === 'str' && editor === 'time' && isTimeOfDay(p.text) && (p.op === '>=' || p.op === '<=')) {
      const lo = p.op === '>=';
      const patch = lo ? { from: p.text } : { to: p.text };
      put(id, src, { ...f, editor, from: null, to: null, ...patch }, (c) =>
        c.kind === 'field' && c.editor === 'time' && (lo ? c.from === null : c.to === null)
          ? { ...c, ...patch }
          : undefined,
      );
    } else if (
      p.t === 'day' &&
      editor === 'date' &&
      (p.op === '>=' || p.op === (pt === 'date' ? '<=' : '<'))
    ) {
      const lo = p.op === '>=';
      const patch = lo ? { from: p.day } : { to: pt === 'date' ? p.day : previousDay(p.day) };
      put(id, src, { ...f, editor, from: null, to: null, ...patch }, (c) =>
        c.kind === 'field' && c.editor === 'date' && (lo ? c.from === null : c.to === null)
          ? { ...c, ...patch }
          : undefined,
      );
    } else stray(src);
  }
  return entries;
}

const isEverywhere = (c: Clause): boolean => c.kind === 'when' || c.kind === 'created_by';

/**
 * The rows of a saved view. `types` are the Objektarten the builder offers: a `when` / `created_by` row that every one
 * of them carries (the builder writes it to all) is one row; a stray one stays a `rule` row of its own Objektart.
 */
export function filterToClauses(
  config: CompiledConfig,
  filters: FilterSource,
  types: readonly string[],
): readonly Clause[] {
  const order = [
    ...types.filter((t) => t in filters),
    ...Object.keys(filters).filter((t) => !types.includes(t)),
  ];
  const perType = new Map(order.map((t) => [t, typeEntries(config, t, filters[t] as string)]));
  // How often every offered type carries one identical row.
  const everywhere = new Map<string, number>();
  const count = (t: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const e of perType.get(t) ?? [])
      if (isEverywhere(e.clause)) {
        const s = JSON.stringify(e.clause);
        m.set(s, (m.get(s) ?? 0) + 1);
      }
    return m;
  };
  const offered = types.map(count);
  for (const [sig, n] of offered[0] ?? [])
    everywhere.set(sig, Math.min(n, ...offered.map((m) => m.get(sig) ?? 0)));

  const out: Clause[] = [];
  const emitted = new Map<string, number>();
  for (const t of order) {
    const seen = new Map<string, number>();
    for (const e of perType.get(t) ?? []) {
      if (!isEverywhere(e.clause)) {
        out.push(e.clause);
        continue;
      }
      const sig = JSON.stringify(e.clause);
      const nth = (seen.get(sig) ?? 0) + 1;
      seen.set(sig, nth);
      if (types.includes(t) && nth <= (everywhere.get(sig) ?? 0)) {
        if (nth > (emitted.get(sig) ?? 0)) {
          emitted.set(sig, nth);
          out.push(e.clause);
        }
      } else for (const source of e.sources) out.push({ kind: 'rule', type: t, source });
    }
  }
  return out;
}
