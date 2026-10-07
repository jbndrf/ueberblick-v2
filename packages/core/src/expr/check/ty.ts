/** Type constructors and relations (assignability, unification, display). */
import { GEO_GEOMETRY_TYPES, type ExprLiteralKind } from '../../registry';
import type { MapNode } from '../ast';
import type { ListTy, MapTy, SimpleTy, Ty } from './types';

export const T = {
  bool: { kind: 'bool' },
  int: { kind: 'int' },
  double: { kind: 'double' },
  string: { kind: 'string' },
  null: { kind: 'null' },
  dyn: { kind: 'dyn' },
  geometry: { kind: 'geometry' },
  timestamp: { kind: 'timestamp' },
  duration: { kind: 'duration' },
} as const satisfies Record<string, SimpleTy>;

export const listOf = (element: Ty): ListTy => ({ kind: 'list', element });
export const mapOf = (key: Ty, value: Ty): MapTy => ({ kind: 'map', key, value });

export const literalTy = (k: ExprLiteralKind): Ty => T[k];

export function show(t: Ty): string {
  switch (t.kind) {
    case 'list':
      return `list<${show(t.element)}>`;
    case 'map':
      return `map<${show(t.key)}, ${show(t.value)}>`;
    case 'record':
      return `{${Object.entries(t.fields)
        .map(([k, v]) => `${k}: ${show(v)}`)
        .join(', ')}}`;
    case 'feature':
      return `feature ${t.type}`;
    default:
      return t.kind;
  }
}

export const isDyn = (t: Ty): boolean => t.kind === 'dyn';
export const isNumeric = (t: Ty): boolean => t.kind === 'int' || t.kind === 'double';

/** May a value of type `from` be used where `to` is required? `dyn` matches anything; int widens to double. */
export function assignable(from: Ty, to: Ty): boolean {
  if (from.kind === 'dyn' || to.kind === 'dyn') return true;
  if (from.kind === 'int' && to.kind === 'double') return true;
  if (from.kind === 'list' && to.kind === 'list') return assignable(from.element, to.element);
  if (from.kind === 'map' && to.kind === 'map')
    return assignable(from.key, to.key) && assignable(from.value, to.value);
  if (from.kind === 'feature' && to.kind === 'feature') return from.type === to.type;
  if (from.kind === 'record' && to.kind === 'record') {
    return Object.entries(to.fields).every(
      ([k, v]) => own(from.fields, k) !== undefined && assignable(own(from.fields, k) as Ty, v),
    );
  }
  return (
    from.kind === to.kind &&
    from.kind !== 'list' &&
    from.kind !== 'map' &&
    from.kind !== 'feature' &&
    from.kind !== 'record'
  );
}

/** The common type of two branches or list elements, or undefined when they do not agree. */
export function unify(a: Ty, b: Ty): Ty | undefined {
  if (a.kind === 'dyn') return b.kind === 'null' ? a : b;
  if (b.kind === 'dyn') return a.kind === 'null' ? b : a;
  if (a.kind === 'null') return b;
  if (b.kind === 'null') return a;
  if (isNumeric(a) && isNumeric(b)) return a.kind === b.kind ? a : T.double;
  if (a.kind === 'list' && b.kind === 'list') {
    const el = unify(a.element, b.element);
    return el && listOf(el);
  }
  if (a.kind === 'map' && b.kind === 'map') {
    const k = unify(a.key, b.key);
    const v = unify(a.value, b.value);
    return k && v && mapOf(k, v);
  }
  return assignable(a, b) && assignable(b, a) ? a : undefined;
}

/** May `==` / `!=` compare these? */
export function comparable(a: Ty, b: Ty): boolean {
  if (a.kind === 'null' || b.kind === 'null') return true;
  if (isNumeric(a) && isNumeric(b)) return true;
  return unify(a, b) !== undefined;
}

/** May `<`, `<=`, `>`, `>=` order these? */
export function orderable(a: Ty, b: Ty): boolean {
  if (isDyn(a) || isDyn(b)) return true;
  if (isNumeric(a) && isNumeric(b)) return true;
  return a.kind === b.kind && (a.kind === 'string' || a.kind === 'timestamp' || a.kind === 'duration');
}

/** Levenshtein distance, capped for speed; used for "did you mean" hints. */
function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j] as number;
      prev[j] = Math.min(tmp + 1, (prev[j - 1] as number) + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length] as number;
}

/** The candidate closest to `name`, when close enough to be a likely typo. */
export function closest(name: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestD = Math.max(2, Math.floor(name.length / 3)) + 1;
  for (const c of candidates) {
    const d = distance(name.toLowerCase(), c.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** A map literal shaped like GeoJSON (`type` plus `coordinates`, or `geometries` for a collection) is a geometry. */
export function isGeometryLiteral(m: MapNode): boolean {
  let type: string | undefined;
  let members = false;
  for (const { key, value } of m.entries) {
    if (key.kind !== 'literal' || key.type !== 'string') continue;
    if (key.value === 'type' && value.kind === 'literal' && typeof value.value === 'string')
      type = value.value;
    if (key.value === 'coordinates' || key.value === 'geometries') members = true;
  }
  return type !== undefined && GEO_GEOMETRY_TYPES.has(type) && members;
}

/** A record's own entry for a user-supplied key; `toString`, `constructor`, `__proto__` … are not entries. */
export function own<V>(record: Readonly<Record<string, V>> | undefined, key: string): V | undefined {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}
