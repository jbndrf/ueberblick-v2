/**
 * A CQL2 filter of an items request as a query plan (F5, H6): `Cql2Seam.read` (fromCql2 then check), then every
 * top-level AND term goes one of two ways. A term `toSql` can translate joins the WHERE of the items query, so it hits
 * the indexes. Any other term (spatial predicates above all) is a residual: core `condition` decides it on the rows the
 * rest let through. A residual must always be bounded by a bbox (R14): the request's `bbox`, or one derived from the
 * geometry of a spatial term. Without one the filter is refused, and evaluation never runs over all features of a type.
 */
import {
  toSql,
  type Bbox,
  type CompiledConfig,
  type FeatureId,
  type Geo,
  type Geometry,
  type Instant,
  type Json,
} from '@ueberblick/core';
import { bboxOf } from '@ueberblick/core/geo/bbox';
import { condition, evaluate, type FeatureAccess } from '@ueberblick/core/expr';
import type { CallNode, Expr } from '@ueberblick/core/expr/compile';
import type { TypedAst } from '@ueberblick/core/expr/compile';
import type { Predicate } from '../../sync';
import type { Cql2Seam, FilterLang } from './seams';

/** Spatial terms whose geometry gives a bbox that every matching feature's bbox must touch. */
const BBOX_TERMS = new Set(['intersects', 'within', 'contains', 'touches', 'dwithin']);
const METRES_PER_DEGREE = 111_320;

export interface FilterEnv {
  readonly cql2: Cql2Seam;
  readonly config: CompiledConfig;
  readonly geo: Geo;
  readonly now: Instant;
  readonly features: FeatureAccess;
}

export interface FilterPlan {
  /** SQL over `features f` for the translated terms. */
  readonly where?: Predicate;
  /** A bbox every matching feature touches, from the spatial terms (WGS84). */
  readonly bbox?: Bbox;
  /** The terms SQL cannot decide; true when the feature passes all of them. */
  readonly residual?: (id: FeatureId) => boolean;
}

export type FilterResult =
  { readonly ok: true; readonly plan: FilterPlan } | { readonly ok: false; readonly message: string };

/** The top-level AND terms of an expression, left to right, without recursion depth limits. */
export function conjuncts(ast: Expr): Expr[] {
  const out: Expr[] = [];
  const stack: Expr[] = [ast];
  while (stack.length > 0) {
    const e = stack.pop() as Expr;
    if (e.kind === 'binary' && e.op === '&&') stack.push(e.right, e.left);
    else out.push(e);
  }
  return out;
}

const sub = (typed: TypedAst, node: Expr): TypedAst => ({
  ast: node,
  type: typed.types.get(node) ?? typed.type,
  types: typed.types,
});

function expandBbox(b: Bbox, metres: number): Bbox {
  const dLat = metres / METRES_PER_DEGREE;
  const lat = Math.min(89, Math.max(Math.abs(b[1]), Math.abs(b[3])) + dLat);
  const dLon = metres / (METRES_PER_DEGREE * Math.cos((lat * Math.PI) / 180));
  return [b[0] - dLon, b[1] - dLat, b[2] + dLon, b[3] + dLat];
}

export const intersect = (a: Bbox | undefined, b: Bbox): Bbox =>
  a === undefined
    ? b
    : [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];

/** The bbox one residual term forces, when it is a spatial call with a constant geometry on one side. */
function termBbox(typed: TypedAst, term: Expr, ctx: Parameters<typeof evaluate>[1]): Bbox | undefined {
  if (term.kind !== 'call' || !BBOX_TERMS.has(term.name) || term.target !== undefined) return undefined;
  const call: CallNode = term;
  const [a, b, metres] = call.args;
  if (a === undefined || b === undefined) return undefined;
  const isRow = (e: Expr): boolean =>
    e.kind === 'member' && e.object.kind === 'ident' && e.object.name === 'self';
  const constant = isRow(a) ? b : isRow(b) ? a : undefined;
  if (constant === undefined) return undefined;
  const r = evaluate(sub(typed, constant), ctx);
  if (
    !r.ok ||
    r.value === null ||
    typeof r.value !== 'object' ||
    Array.isArray(r.value) ||
    !('type' in r.value)
  )
    return undefined;
  const box = bboxOf(r.value as unknown as Geometry);
  if (box === undefined) return undefined;
  if (call.name !== 'dwithin') return box;
  const m = metres === undefined ? undefined : evaluate(sub(typed, metres), ctx);
  return m?.ok === true && typeof m.value === 'number' && m.value >= 0 ? expandBbox(box, m.value) : undefined;
}

export function planFilter(
  env: FilterEnv,
  type: string,
  filter: string,
  lang: FilterLang,
  requestBbox: Bbox | undefined,
): FilterResult {
  let input: string | object = filter;
  if (lang === 'cql2-json') {
    try {
      input = JSON.parse(filter) as object;
    } catch {
      return { ok: false, message: 'filter is not valid JSON.' };
    }
  }
  const read = env.cql2.read(env.config, type, input, lang);
  if (!read.ok) return { ok: false, message: read.message };
  const typed = read.typed;
  const ctxFor = (self: FeatureId | undefined): Parameters<typeof evaluate>[1] => ({
    vars: new Map(self === undefined ? [] : [['self', { $feature: self }]]),
    features: env.features,
    now: env.now,
    relations: env.config.relations,
    geo: env.geo,
  });

  const parts: string[] = [];
  const params: Json[] = [];
  const residual: TypedAst[] = [];
  let bbox: Bbox | undefined;
  for (const term of conjuncts(typed.ast)) {
    const t = sub(typed, term);
    const sql = toSql(t, { self: 'f', vars: new Map(), geo: env.geo });
    if (sql.ok) {
      parts.push(`(${sql.sql})`);
      params.push(...sql.params);
      continue;
    }
    residual.push(t);
    const box = termBbox(typed, term, ctxFor(undefined));
    if (box !== undefined) bbox = intersect(bbox, box);
  }
  if (residual.length > 0 && bbox === undefined && requestBbox === undefined)
    return {
      ok: false,
      message:
        'This filter cannot be answered from an index. Add a bbox, or a spatial term such as S_INTERSECTS with a geometry.',
    };
  return {
    ok: true,
    plan: {
      ...(parts.length > 0 ? { where: { sql: parts.join(' AND '), params } } : {}),
      ...(bbox !== undefined ? { bbox } : {}),
      ...(residual.length > 0
        ? { residual: (id: FeatureId) => residual.every((r) => condition(r, ctxFor(id)).value) }
        : {}),
    },
  };
}
