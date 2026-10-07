/**
 * CQL2 JSON encoding -> AST. JSON has no source offsets, so every node carries the span of
 * the whole input and each error names its location as a JSON pointer ("at /args/1: …").
 * Size is bounded by an element budget, depth by `maxDepth` (H4).
 */
import type { Expr, Span } from '../ast';
import {
  ARITHMETIC,
  COMPARISONS,
  Cql2Failure,
  SPATIAL_FUNCTIONS,
  bbox,
  between,
  binary,
  bool,
  casei,
  dateOf,
  geometry,
  inList,
  isNull,
  like,
  negate,
  not,
  num,
  prop,
  spatial,
  str,
  unsupportedReason,
} from './build';

type Json = Record<string, unknown>;

class JsonReader {
  private budget: number;

  constructor(
    private readonly span: Span,
    private readonly maxDepth: number,
    maxNodes: number,
  ) {
    this.budget = maxNodes;
  }

  private fail(message: string, path: string): never {
    throw new Cql2Failure({ message: `at ${path || '/'}: ${message}`, span: this.span });
  }

  expr(v: unknown, path = '', depth = 1): Expr {
    if (depth > this.maxDepth)
      this.fail(`filter is nested deeper than ${String(this.maxDepth)} levels`, path);
    if (--this.budget < 0) this.fail('filter is too large', path);
    switch (typeof v) {
      case 'boolean':
        return bool(v, this.span);
      case 'string':
        return str(v, this.span);
      case 'number':
        if (!Number.isFinite(v)) return this.fail('numbers must be finite', path);
        return num(v, Number.isInteger(v) ? 'int' : 'double', this.span);
      case 'object':
        if (v === null) return this.fail('null is not supported as a value; use isNull', path);
        if (Array.isArray(v)) return this.fail("a list is only allowed as the second argument of 'in'", path);
        return this.object(v as Json, path, depth);
      default:
        return this.fail(`unsupported value of type ${typeof v}`, path);
    }
  }

  private object(o: Json, path: string, depth: number): Expr {
    const s = this.span;
    if ('property' in o) {
      if (typeof o['property'] !== 'string') return this.fail("'property' must be a string", path);
      return prop(o['property'], s);
    }
    if ('op' in o) return this.operation(o, path, depth);
    for (const k of ['date', 'timestamp'] as const) {
      if (k in o) {
        const text = o[k];
        if (typeof text !== 'string') return this.fail(`'${k}' must be a string`, path);
        return dateOf(str(text, s), s);
      }
    }
    if ('bbox' in o) {
      const b = o['bbox'];
      if (!Array.isArray(b) || !b.every((n) => typeof n === 'number'))
        return this.fail("'bbox' must be a list of numbers", path);
      return bbox(b as number[], s);
    }
    if ('interval' in o) return this.fail("'interval' is not supported", path);
    if ('function' in o) {
      const f = o['function'];
      const name = typeof f === 'object' && f !== null ? (f as Json)['name'] : undefined;
      return this.fail(`function '${String(name)}' is not supported`, path);
    }
    if ('type' in o) return this.geometry(o, path);
    return this.fail('unrecognised object: expected property, op, date, timestamp, bbox or a geometry', path);
  }

  private geometry(o: Json, path: string): Expr {
    try {
      return geometry(o, this.span, `geometry at ${path || '/'}`);
    } catch (e) {
      if (e instanceof Cql2Failure) return this.fail(e.error.message, path);
      throw e;
    }
  }

  private args(o: Json, path: string): readonly unknown[] {
    const a = o['args'];
    if (!Array.isArray(a)) return this.fail("'args' must be a list", path);
    return a;
  }

  private operation(o: Json, path: string, depth: number): Expr {
    const s = this.span;
    const raw = o['op'];
    if (typeof raw !== 'string') return this.fail("'op' must be a string", path);
    const name = raw.toLowerCase();
    const args = this.args(o, path);
    const arg = (i: number): Expr => this.expr(args[i], `${path}/args/${String(i)}`, depth + 1);
    const exactly = (n: number): void => {
      if (args.length !== n)
        this.fail(
          `'${raw}' needs exactly ${String(n)} argument${n === 1 ? '' : 's'}, found ${String(args.length)}`,
          path,
        );
    };
    const all = (): Expr[] => args.map((_, i) => arg(i));

    if (name === 'and' || name === 'or') {
      if (args.length < 2) return this.fail(`'${raw}' needs at least two arguments`, path);
      const [first, ...rest] = all() as [Expr, ...Expr[]];
      return rest.reduce((l, r) => binary(name === 'and' ? '&&' : '||', l, r), first);
    }
    const cmp = COMPARISONS.get(name);
    if (cmp !== undefined) {
      exactly(2);
      return binary(cmp, arg(0), arg(1));
    }
    const arith = ARITHMETIC.find((a) => a === name);
    if (arith !== undefined) {
      if (arith === '-' && args.length === 1) return negate(arg(0), s);
      exactly(2);
      return binary(arith, arg(0), arg(1));
    }
    switch (name) {
      case 'not':
        exactly(1);
        return not(arg(0));
      case 'isnull':
        exactly(1);
        return isNull(arg(0));
      case 'like':
        exactly(2);
        return this.guard(() => like(arg(0), arg(1)), path);
      case 'between':
        exactly(3);
        return between(arg(0), arg(1), arg(2));
      case 'casei':
        exactly(1);
        return casei(arg(0), s);
      case 'in': {
        exactly(2);
        const list = args[1];
        if (!Array.isArray(list))
          return this.fail("'in' needs a list as its second argument", `${path}/args/1`);
        const items = list.map((x, i) => this.expr(x, `${path}/args/1/${String(i)}`, depth + 1));
        return inList(arg(0), items, s);
      }
      case 'div':
      case '^':
        return this.fail(`operator '${raw}' is not supported`, path);
      default:
        if (SPATIAL_FUNCTIONS.has(name)) return this.guard(() => spatial(raw, all(), s), path);
        return this.fail(unsupportedReason(raw) ?? `unknown operator '${raw}'`, path);
    }
  }

  private guard(f: () => Expr, path: string): Expr {
    try {
      return f();
    } catch (e) {
      if (e instanceof Cql2Failure && !e.error.message.startsWith('at '))
        return this.fail(e.error.message, path);
      throw e;
    }
  }
}

export function fromJson(value: unknown, span: Span, maxDepth: number, maxNodes: number): Expr {
  return new JsonReader(span, maxDepth, maxNodes).expr(value);
}
