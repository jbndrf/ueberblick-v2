/**
 * Node builders shared by the text and the JSON reader, so both encodings of one filter
 * produce the same AST (WP-109). Everything here produces nodes of `expr/ast.ts` only.
 * Geometry literals become map literals shaped like GeoJSON (`{'type': 'Point', ...}`).
 */
import type { CallNode, Expr, ParseError, Span } from '../ast';
import { GEO_GEOMETRY_TYPES, type ExprBinaryOperator, type GeoPredicate } from '../../registry';

export class Cql2Failure extends Error {
  constructor(readonly error: ParseError) {
    super(error.message);
  }
}

export function fail(message: string, span: Span): never {
  throw new Cql2Failure({ message, span });
}

/** CQL2 spatial operators that map to a registered spatial function (Basic Spatial). */
export const SPATIAL_FUNCTIONS: ReadonlyMap<string, GeoPredicate> = new Map([
  ['s_intersects', 'intersects'],
  ['s_within', 'within'],
  ['s_contains', 'contains'],
  ['s_touches', 'touches'],
  ['s_disjoint', 'disjoint'],
]);

/** CQL2 comparison operators (both encodings) and the operator they become. */
export const COMPARISONS: ReadonlyMap<string, ExprBinaryOperator> = new Map([
  ['=', '=='],
  ['<>', '!='],
  ['<', '<'],
  ['<=', '<='],
  ['>', '>'],
  ['>=', '>='],
]);

export const ARITHMETIC: readonly ExprBinaryOperator[] = ['+', '-', '*', '/', '%'];

const join = (a: Span, b: Span): Span => ({ start: a.start, end: b.end });
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const str = (value: string, span: Span): Expr => ({ kind: 'literal', type: 'string', value, span });
export const bool = (value: boolean, span: Span): Expr => ({ kind: 'literal', type: 'bool', value, span });
export const num = (value: number, type: 'int' | 'double', span: Span): Expr => ({
  kind: 'literal',
  type,
  value,
  span,
});
const nul = (span: Span): Expr => ({ kind: 'literal', type: 'null', value: null, span });

/** A property reference: `self.<prop>`; names that are not plain identifiers use `self['<name>']`. */
export function prop(name: string, span: Span): Expr {
  const self: Expr = { kind: 'ident', name: 'self', span };
  if (IDENT.test(name)) return { kind: 'member', object: self, field: name, span };
  return { kind: 'index', object: self, index: str(name, span), span };
}

export const binary = (op: ExprBinaryOperator, left: Expr, right: Expr): Expr => ({
  kind: 'binary',
  op,
  left,
  right,
  span: join(left.span, right.span),
});

export const not = (operand: Expr, span: Span = operand.span): Expr => ({
  kind: 'unary',
  op: '!',
  operand,
  span,
});
export const negate = (operand: Expr, span: Span): Expr => ({ kind: 'unary', op: '-', operand, span });
export const isNull = (x: Expr, span: Span = x.span): Expr => binary('==', x, nul(span));
export const inList = (x: Expr, elements: readonly Expr[], span: Span): Expr =>
  binary('in', x, { kind: 'list', elements, span });
export const between = (x: Expr, lo: Expr, hi: Expr): Expr =>
  binary('&&', binary('>=', x, lo), binary('<=', x, hi));

export function call(name: string, args: readonly Expr[], span: Span, target?: Expr): CallNode {
  return target ? { kind: 'call', name, target, args, span } : { kind: 'call', name, args, span };
}

/** `DATE('…')` and `TIMESTAMP('…')` both become `date(s)`. */
export const dateOf = (text: Expr, span: Span): Expr => call('date', [text], span);

/** `CASEI(x)`: lower-cases `x`; a string literal is folded on the spot. */
export function casei(x: Expr, span: Span): Expr {
  if (x.kind === 'literal' && x.type === 'string') return str(String(x.value).toLowerCase(), span);
  return call('lower', [], span, x);
}

/** Why a function name is not supported, or null when it is simply unknown. */
export function unsupportedReason(name: string): string | null {
  const n = name.toLowerCase();
  if (n.startsWith('t_')) return `temporal function '${name}' is not supported`;
  if (n.startsWith('a_')) return `array function '${name}' is not supported`;
  if (n.startsWith('s_')) {
    return `spatial operator '${name}' is not supported (supported: S_INTERSECTS, S_WITHIN, S_CONTAINS, S_TOUCHES, S_DISJOINT)`;
  }
  if (n === 'accenti') return "'ACCENTI' is not supported";
  return null;
}

const isProperty = (e: Expr): boolean => e.kind === 'member' || e.kind === 'index';
const isGeometry = (e: Expr): boolean => e.kind === 'map';

/** `S_INTERSECTS(a, b)` etc. Both arguments must be a property or a geometry literal. */
export function spatial(name: string, args: readonly Expr[], span: Span): Expr {
  const fn = SPATIAL_FUNCTIONS.get(name.toLowerCase());
  if (fn === undefined) return fail(unsupportedReason(name) ?? `function '${name}' is not supported`, span);
  if (args.length !== 2) return fail(`'${name}' needs two arguments, found ${String(args.length)}`, span);
  for (const a of args) {
    if (!isProperty(a) && !isGeometry(a)) {
      fail(`'${name}' expects a property or a geometry, found another expression`, a.span);
    }
  }
  return call(fn, args, span);
}

/** `x LIKE 'pattern'`, where it can be written with the text functions; a clear error otherwise. */
export function like(target: Expr, pattern: Expr): Expr {
  if (pattern.kind !== 'literal' || pattern.type !== 'string') {
    return fail('LIKE needs a string literal pattern', pattern.span);
  }
  const span = join(target.span, pattern.span);
  const parts: { text: string; wild: boolean }[] = [];
  const raw = String(pattern.value);
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charAt(i);
    if (c === '\\' && i + 1 < raw.length) parts.push({ text: raw.charAt(++i), wild: false });
    else if (c === '_')
      return fail("LIKE wildcard '_' cannot be expressed; use '%' or an exact string", pattern.span);
    else parts.push({ text: c, wild: c === '%' });
  }
  const lead = parts[0]?.wild === true;
  const trail = parts.length > 1 && parts[parts.length - 1]?.wild === true;
  const core = parts.slice(lead ? 1 : 0, parts.length - (trail ? 1 : 0));
  if (core.some((p) => p.wild)) {
    return fail("LIKE pattern is not supported: '%' is only allowed at the start or the end", pattern.span);
  }
  if (lead && parts.length === 1) return binary('!=', target, nul(pattern.span));
  const lit = str(core.map((p) => p.text).join(''), pattern.span);
  if (lead && trail) return call('contains', [lit], span, target);
  if (trail) return call('startsWith', [lit], span, target);
  if (lead) return call('endsWith', [lit], span, target);
  return binary('==', target, lit);
}

// ---- geometry literals ------------------------------------------------------------------

const dbl = (n: number, span: Span): Expr => num(n, 'double', span);
const entry = (k: string, value: Expr, span: Span) => ({ key: str(k, span), value, span });
const nest = (v: unknown, span: Span): Expr =>
  Array.isArray(v) ? { kind: 'list', elements: v.map((x) => nest(x, span)), span } : dbl(v as number, span);

const isPosition = (v: unknown): boolean =>
  Array.isArray(v) &&
  (v.length === 2 || v.length === 3) &&
  v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Nesting depth of the coordinates per GeoJSON type (0 = one position). */
const COORD_DEPTH: Readonly<Record<string, number>> = {
  Point: 0,
  MultiPoint: 1,
  LineString: 1,
  MultiLineString: 2,
  Polygon: 2,
  MultiPolygon: 3,
};

function checkCoordinates(v: unknown, depth: number, span: Span, where: string): void {
  if (depth === 0) {
    if (!isPosition(v)) fail(`${where}: a position needs 2 or 3 finite coordinates`, span);
    return;
  }
  if (!Array.isArray(v)) fail(`${where}: coordinates must be a list`, span);
  for (const x of v) checkCoordinates(x, depth - 1, span, where);
}

/** A GeoJSON geometry object as a map literal. `where` prefixes error messages. */
export function geometry(g: unknown, span: Span, where = 'geometry', budget = 64): Expr {
  if (budget < 0) return fail('geometry is nested too deeply', span);
  if (typeof g !== 'object' || g === null) return fail(`${where}: expected a geometry object`, span);
  const o = g as Record<string, unknown>;
  const type = o['type'];
  if (typeof type !== 'string' || !GEO_GEOMETRY_TYPES.has(type)) {
    return fail(`${where}: unknown geometry type ${JSON.stringify(type)}`, span);
  }
  if (type === 'GeometryCollection') {
    const parts = o['geometries'];
    if (!Array.isArray(parts)) return fail(`${where}: 'geometries' must be a list`, span);
    const elements = parts.map((p) => geometry(p, span, where, budget - 1));
    const list: Expr = { kind: 'list', elements, span };
    return {
      kind: 'map',
      entries: [entry('type', str(type, span), span), entry('geometries', list, span)],
      span,
    };
  }
  const coords = o['coordinates'];
  checkCoordinates(coords, COORD_DEPTH[type] as number, span, where);
  return {
    kind: 'map',
    entries: [entry('type', str(type, span), span), entry('coordinates', nest(coords, span), span)],
    span,
  };
}

/** BBOX / ENVELOPE / `bbox` as a Polygon (2D only: w,s,e,n). A 3D box is rejected, never flattened. */
export function bbox(v: readonly number[], span: Span): Expr {
  if (v.length === 6) return fail('3D bbox is not supported yet', span);
  if (v.length !== 4 || !v.every((n) => Number.isFinite(n))) {
    return fail('a bounding box needs 4 finite numbers', span);
  }
  const [w, s, e, n] = v;
  const ring = [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ];
  return geometry({ type: 'Polygon', coordinates: [ring] }, span, 'bbox');
}
