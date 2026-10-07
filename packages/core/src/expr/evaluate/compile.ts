/**
 * Compiles a typed AST into closures, once per `TypedAst` (docs/12 "compile once"). Static types decide
 * integer division, timestamp comparison and to-one versus to-many relations at compile time. The
 * closures throw `EvalFault`; `evaluate` turns that into an error result, so nothing escapes.
 */
import type { CallNode, ComprehensionNode, Expr, HasNode, IndexNode, MemberNode, Span } from '../ast';
import type { Ty } from '../check/types';
import type { EvalContext, EvalValue, FeatureRef } from '../contract';
import { FUNCTIONS } from '../functions';
import { EvalFault, fail, isFeatureRef, isMap, type EvalMap } from '../functions/support';
import { member, present, related } from './access';
import { compileChain } from './chain';
import { constness, remember } from './fold';
import { negate, valueKind } from './ops';
import type { Fn, Run } from './run';
import type { TypedAst } from '../check/check';

const MAX_DEPTH = 256;

type Types = ReadonlyMap<Expr, Ty>;
const kindOf = (types: Types, e: Expr): string => types.get(e)?.kind ?? 'dyn';

/** Bool, null or the fault, for macros (`exists`, `all`, `filter`). */
type Side = boolean | null | EvalFault;

function side(f: Fn, r: Run, span: Span, what: string): Side {
  try {
    const v = f(r);
    if (typeof v === 'boolean' || v === null) return v;
    return new EvalFault(`${what} needs a bool but got ${valueKind(v)}`, span);
  } catch (e) {
    if (e instanceof EvalFault) return e;
    throw e;
  }
}

/** `member` with the two commonest cases read in place: a feature's property and a map's key. */
function read(ctx: EvalContext, v: EvalValue, field: string, many: boolean): EvalValue {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    if ('$feature' in v) {
      const f = v as FeatureRef;
      const p = ctx.features.property(f.$feature, field);
      return p !== undefined ? p : related(ctx, f, field, many);
    }
    const m = Object.hasOwn(v, field) ? (v as EvalMap)[field] : undefined;
    return m === undefined ? null : (m as EvalValue);
  }
  return member(ctx, v, field, many);
}

const withSpan = (e: EvalFault, span: Span): EvalFault => (e.span ? e : new EvalFault(e.message, span));

class Compiler {
  private readonly scope: string[] = [];
  /** Deepest nesting of comprehension variables: the slots a run needs. */
  slots = 0;
  constructor(private readonly types: Types) {}

  compile(e: Expr, depth = 0): Fn {
    if (depth > MAX_DEPTH) return () => fail('expression is nested too deeply');
    const f = this.fold(e, this.node(e, depth));
    // Only operations that can fault add their span; a fault without one takes the nearest such ancestor's.
    // A chain and a call give their own faults a span.
    if (
      e.kind === 'literal' ||
      e.kind === 'ident' ||
      e.kind === 'member' ||
      e.kind === 'has' ||
      e.kind === 'binary' ||
      e.kind === 'call'
    )
      return f;
    return (r) => {
      try {
        return f(r);
      } catch (x) {
        throw x instanceof EvalFault ? withSpan(x, e.span) : x;
      }
    };
  }

  /** A computed constant (`date('2026-01-01')`, `now - days(7)`) is evaluated once, not per feature. */
  private fold(e: Expr, f: Fn): Fn {
    if (e.kind !== 'unary' && e.kind !== 'binary' && e.kind !== 'call') return f;
    const c = constness(e, (name) => this.scope.includes(name));
    return c ? remember(f, c) : f;
  }

  private node(e: Expr, d: number): Fn {
    switch (e.kind) {
      case 'literal': {
        const v = e.value;
        return () => v;
      }
      case 'ident':
        return this.ident(e.name);
      case 'member':
        return this.memberNode(e, d);
      case 'index':
        return this.indexNode(e, d);
      case 'call':
        return this.call(e, d);
      case 'has':
        return this.has(e, d);
      case 'comprehension':
        return this.comprehension(e, d);
      case 'unary':
        return this.unary(e.op, this.compile(e.operand, d + 1));
      case 'binary':
        return compileChain(e, this.types, (x, depth) => this.compile(x, depth), d + 1);
      case 'conditional': {
        const t = this.compile(e.test, d + 1);
        const a = this.compile(e.then, d + 1);
        const b = this.compile(e.else, d + 1);
        return (r) => {
          const c = t(r);
          if (c === null) return null;
          if (typeof c !== 'boolean') return fail(`the condition of ?: needs a bool but got ${valueKind(c)}`);
          return c ? a(r) : b(r);
        };
      }
      case 'list': {
        const els = e.elements.map((x) => this.compile(x, d + 1));
        return (r) => els.map((f) => f(r));
      }
      case 'map': {
        const entries = e.entries.map(
          (en) => [this.compile(en.key, d + 1), this.compile(en.value, d + 1)] as const,
        );
        return (r) => {
          const out: Record<string, EvalValue> = {};
          for (const [k, v] of entries) {
            const key = k(r);
            if (typeof key !== 'string' && typeof key !== 'number' && typeof key !== 'boolean')
              return fail('map keys must be string, int or bool');
            const name = String(key);
            // '$feature' would forge a feature reference; '$' is reserved for the platform.
            if (name.startsWith('$')) return fail("map keys must not start with '$'");
            Object.defineProperty(out, name, {
              value: v(r),
              enumerable: true,
              writable: true,
              configurable: true,
            });
          }
          // A map may hold feature references; `EvalValue` types maps as JSON only.
          return out as unknown as EvalValue;
        };
      }
    }
  }

  private ident(name: string): Fn {
    const slot = this.scope.lastIndexOf(name);
    if (slot >= 0) return (r) => r.slots[slot] as EvalValue;
    if (name === 'now') return (r) => r.ctx.now;
    return (r) => {
      const v = r.ctx.vars.get(name);
      return v === undefined ? fail(`unknown name '${name}'`) : v;
    };
  }

  private memberNode(e: MemberNode, d: number): Fn {
    const many = kindOf(this.types, e) !== 'feature';
    const field = e.field;
    const o = e.object;
    // `self.stage`, the commonest read: the variable and its property in one closure.
    if (o.kind === 'ident' && o.name !== 'now' && this.scope.lastIndexOf(o.name) < 0) {
      const name = o.name;
      return (r) => {
        const v = r.ctx.vars.get(name);
        if (v === undefined) return fail(`unknown name '${name}'`);
        return read(r.ctx, v, field, many);
      };
    }
    const obj = this.compile(o, d + 1);
    return (r) => read(r.ctx, obj(r), field, many);
  }

  private indexNode(e: IndexNode, d: number): Fn {
    const obj = this.compile(e.object, d + 1);
    const idx = this.compile(e.index, d + 1);
    return (r) => {
      const o = obj(r);
      const i = idx(r);
      if (o === null || i === null) return null;
      if (Array.isArray(o)) {
        if (typeof i !== 'number' || !Number.isInteger(i)) return fail('a list index must be an int');
        if (i < 0 || i >= o.length) return fail('the list index is out of range');
        return o[i] as EvalValue;
      }
      if (typeof i === 'string' && (isMap(o) || isFeatureRef(o))) return member(r.ctx, o, i, true);
      if (isMap(o)) return fail('a map is indexed with a string');
      return fail(`cannot index ${valueKind(o)}`);
    };
  }

  private has(e: HasNode, d: number): Fn {
    const obj = this.compile(e.select.object, d + 1);
    const field = e.select.field;
    return (r) => present(r.ctx, obj(r), field);
  }

  private unary(op: '!' | '-', operand: Fn): Fn {
    if (op === '-')
      return (r) => {
        const v = operand(r);
        return v === null ? null : negate(v);
      };
    return (r) => {
      const v = operand(r);
      if (v === null) return null;
      return typeof v === 'boolean' ? !v : fail(`operator '!' needs a bool but got ${valueKind(v)}`);
    };
  }

  private call(e: CallNode, d: number): Fn {
    const def = FUNCTIONS.get(e.name);
    if (!def) return () => fail(`unknown function '${e.name}'`);
    const target = e.target ? this.compile(e.target, d + 1) : undefined;
    const args = e.args.map((a) => this.compile(a, d + 1));
    const evaluate = def.evaluate;
    const { span } = e;
    // `Run` carries `ctx`, so it is the function environment itself: no per-call wrapper object.
    const at = (x: unknown): never => {
      throw x instanceof EvalFault ? withSpan(x, span) : x;
    };
    if (args.length === 1) {
      const a0 = args[0] as Fn;
      return (r) => {
        try {
          const t = target ? target(r) : undefined;
          if (t === null) return null;
          const v = a0(r);
          return v === null ? null : evaluate({ target: t, args: [v] }, r);
        } catch (x) {
          return at(x);
        }
      };
    }
    return (r) => {
      try {
        const t = target ? target(r) : undefined;
        if (t === null) return null;
        const values: EvalValue[] = [];
        for (const a of args) {
          const v = a(r);
          if (v === null) return null;
          values.push(v);
        }
        return evaluate({ target: t, args: values }, r);
      } catch (x) {
        return at(x);
      }
    };
  }

  private comprehension(e: ComprehensionNode, d: number): Fn {
    const range = this.compile(e.range, d + 1);
    const slot = this.scope.length;
    this.scope.push(e.variable);
    this.slots = Math.max(this.slots, this.scope.length);
    const body = this.compile(e.body, d + 1);
    this.scope.pop();
    const { macro, span } = e;
    const what = `the predicate of ${macro}()`;
    return (r) => {
      const rv = range(r);
      if (rv === null) return null;
      const items = Array.isArray(rv) ? rv : isMap(rv) ? Object.keys(rv) : fail(`${macro}() needs a list`);
      if ((r.budget -= items.length) < 0) return fail('expression is too expensive to evaluate');
      const mapped: EvalValue[] = [];
      let fault: EvalFault | undefined;
      let unknown = false;
      for (const item of items) {
        r.slots[slot] = item;
        if (macro === 'map') {
          mapped.push(body(r));
          continue;
        }
        const s = side(body, r, span, what);
        if (s instanceof EvalFault) fault ??= s;
        else if (s === null) unknown = true;
        else if (macro === 'filter') {
          if (s) mapped.push(item);
        } else if (s === (macro === 'exists')) return s;
      }
      if (fault) throw fault;
      if (macro === 'map' || macro === 'filter') return mapped;
      return unknown ? null : macro === 'all';
    };
  }
}

export interface Compiled {
  readonly fn: Fn;
  /** Comprehension slots a run needs (0: none). */
  readonly slots: number;
}

const cache = new WeakMap<TypedAst, Compiled>();
// One expression is usually evaluated for many features in a row: remember the last one and skip the lookup.
let lastTyped: TypedAst | undefined;
let lastCompiled: Compiled | undefined;

/** The compiled form of `typed`, built on first use. */
export function compiled(typed: TypedAst): Compiled {
  if (typed === lastTyped && lastCompiled) return lastCompiled;
  let c = cache.get(typed);
  if (!c) {
    const compiler = new Compiler(typed.types);
    const fn = compiler.compile(typed.ast);
    c = { fn, slots: compiler.slots };
    cache.set(typed, c);
  }
  lastTyped = typed;
  lastCompiled = c;
  return c;
}
