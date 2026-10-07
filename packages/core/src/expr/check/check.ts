/**
 * Type checker for the rule language (docs/06-rule-language.md). Resolves names against an `Env`,
 * infers a type for every node and reports all errors with spans and fix hints. Pure and total.
 */
import type { CallNode, ComprehensionNode, Expr, HasNode, MemberNode, Span } from '../ast';
import type { ExprErrorCode, ExprErrorParams } from '../../registry/expr-errors';
import { systemFieldOf } from '../../registry/system-fields';
import { checkCall } from './calls';
import { checkMatchesPattern } from './matches';
import { HISTORY_FUNCTIONS } from './functions';
import { checkHistory } from './history';
import { binaryType } from './operators';
import {
  T,
  assignable,
  closest,
  isDyn,
  isGeometryLiteral,
  isNumeric,
  listOf,
  literalTy,
  own,
  show,
  unify,
} from './ty';
import type { CheckError, CheckOptions, Env, Ty } from './types';

export interface TypedAst {
  readonly ast: Expr;
  /** The type of the whole expression. */
  readonly type: Ty;
  /** The inferred type of every node. */
  readonly types: ReadonlyMap<Expr, Ty>;
}

export type CheckResult =
  | { readonly ok: true; readonly typed: TypedAst }
  | { readonly ok: false; readonly errors: readonly CheckError[] };

interface Scope {
  readonly name: string;
  readonly ty: Ty;
  readonly parent: Scope | undefined;
}

export class Checker {
  readonly errors: CheckError[] = [];
  readonly types = new Map<Expr, Ty>();

  constructor(readonly env: Env) {}

  /** `hint` is `[english, variant]` when the error has a hint; the variant names its wording (registry `EXPR_ERRORS`). */
  err(
    code: ExprErrorCode,
    message: string,
    span: Span,
    params: ExprErrorParams = {},
    hint?: readonly [string, string],
  ): Ty {
    this.errors.push(
      hint === undefined
        ? { code, message, span, params }
        : { code, message, span, params: { ...params, hint_variant: hint[1] }, hint: hint[0] },
    );
    return T.dyn;
  }

  infer(e: Expr, scope: Scope | undefined): Ty {
    if (e.kind === 'binary' && e.left.kind === 'binary') return this.inferChain(e, scope);
    const t = this.inferNode(e, scope);
    this.types.set(e, t);
    return t;
  }

  /** Long left-associative chains (`a || b || ...`) are walked iteratively, so they cannot overflow the stack. */
  private inferChain(top: Extract<Expr, { kind: 'binary' }>, scope: Scope | undefined): Ty {
    const spine: Extract<Expr, { kind: 'binary' }>[] = [];
    let cur: Expr = top;
    while (cur.kind === 'binary') {
      spine.push(cur);
      cur = cur.left;
    }
    let left = this.infer(cur, scope);
    for (let i = spine.length - 1; i >= 0; i--) {
      const node = spine[i] as Extract<Expr, { kind: 'binary' }>;
      left = this.binary(node.op, left, this.infer(node.right, scope), node.span);
      this.types.set(node, left);
    }
    return left;
  }

  private inferNode(e: Expr, scope: Scope | undefined): Ty {
    switch (e.kind) {
      case 'literal':
        return literalTy(e.type);
      case 'ident':
        return this.ident(e.name, e.span, scope);
      case 'member':
        return this.member(e, scope);
      case 'index':
        return this.index(e, scope);
      case 'call':
        return this.call(e, scope);
      case 'has':
        return this.has(e, scope);
      case 'comprehension':
        return this.comprehension(e, scope);
      case 'unary': {
        const o = this.infer(e.operand, scope);
        if (e.op === '!')
          return this.expectTy(o, T.bool, e.operand.span, "operator '!'", 'not_operand') ?? T.bool;
        if (isNumeric(o) || o.kind === 'duration' || isDyn(o)) return o;
        return this.err(
          'minus_operand',
          `operator '-' needs a number or duration but got ${show(o)}`,
          e.operand.span,
          { actual: show(o) },
        );
      }
      case 'binary':
        return this.binary(e.op, this.infer(e.left, scope), this.infer(e.right, scope), e.span);
      case 'conditional': {
        this.expectTy(
          this.infer(e.test, scope),
          T.bool,
          e.test.span,
          'the condition of ?:',
          'condition_type',
        );
        const a = this.infer(e.then, scope);
        const b = this.infer(e.else, scope);
        const u = unify(a, b);
        if (u) return u;
        return this.err(
          'branch_types_differ',
          `the two branches of ?: have different types (${show(a)} and ${show(b)})`,
          e.span,
          { left: show(a), right: show(b) },
        );
      }
      case 'list': {
        let el: Ty | undefined;
        for (const x of e.elements) {
          const t = this.infer(x, scope);
          el = el === undefined ? t : (unify(el, t) ?? T.dyn);
        }
        return listOf(el ?? T.dyn);
      }
      case 'map': {
        if (isGeometryLiteral(e)) {
          for (const en of e.entries) this.infer(en.value, scope);
          return T.geometry;
        }
        let k: Ty | undefined;
        let v: Ty | undefined;
        for (const en of e.entries) {
          const kt = this.infer(en.key, scope);
          const vt = this.infer(en.value, scope);
          if (!['string', 'int', 'bool', 'dyn'].includes(kt.kind)) {
            this.err(
              'map_key_type',
              `map keys must be string, int or bool but got ${show(kt)}`,
              en.key.span,
              { actual: show(kt) },
            );
          }
          k = k === undefined ? kt : (unify(k, kt) ?? T.dyn);
          v = v === undefined ? vt : (unify(v, vt) ?? T.dyn);
        }
        return { kind: 'map', key: k ?? T.dyn, value: v ?? T.dyn };
      }
    }
  }

  /** Reports a mismatch and returns undefined, or returns nothing when `t` fits `want`. */
  expectTy(
    t: Ty,
    want: Ty,
    span: Span,
    what: string,
    code: ExprErrorCode,
    extra: ExprErrorParams = {},
  ): undefined {
    if (!assignable(t, want)) {
      this.err(code, `${what} needs ${show(want)} but got ${show(t)}`, span, {
        ...extra,
        expected: show(want),
        actual: show(t),
      });
    }
    return undefined;
  }

  private ident(name: string, span: Span, scope: Scope | undefined): Ty {
    for (let s = scope; s; s = s.parent) if (s.name === name) return s.ty;
    const v = own(this.env.vars, name);
    if (v) return v;
    const known = [...Object.keys(this.env.vars)];
    for (let s = scope; s; s = s.parent) known.push(s.name);
    const near = closest(name, known);
    return this.err(
      'unknown_name',
      `unknown name '${name}'`,
      span,
      near ? { name, near } : { name, known: known.join(', ') },
      near
        ? [`did you mean '${near}'?`, 'near']
        : [`names in scope: ${known.join(', ') || '(none)'}`, known.length > 0 ? 'known' : 'none'],
    );
  }

  fieldsOf(t: Ty, span: Span): Readonly<Record<string, Ty>> | undefined {
    if (t.kind === 'record') return t.fields;
    if (t.kind === 'feature') {
      const f = own(this.env.features, t.type);
      if (!f) this.err('unknown_feature_type', `unknown feature type '${t.type}'`, span, { type: t.type });
      return f;
    }
    return undefined;
  }

  private selectField(obj: Ty, field: string, span: Span): Ty {
    if (isDyn(obj)) return T.dyn;
    if (obj.kind === 'map') return obj.value;
    const fields = this.fieldsOf(obj, span);
    if (fields) {
      const f = own(fields, field);
      if (f) {
        const system = obj.kind === 'feature' ? systemFieldOf(field) : undefined;
        if (system !== undefined && !system.sql && this.env.sql) {
          return this.err(
            'field_not_in_sql',
            `self.${field} is not available in this context yet`,
            span,
            { field },
            ['it can be read in task and rule conditions, not in a filter that runs as SQL', 'default'],
          );
        }
        return f;
      }
      const near = closest(field, Object.keys(fields));
      const owner = obj.kind === 'feature' ? `feature type '${obj.type}'` : 'this record';
      // A-009: a participant has `roles` (a list), never a single `role`.
      if (field === 'role' && own(fields, 'roles')) {
        return this.err('no_role_property', `no property 'role' on ${owner}`, span, {}, [
          "use `'<x>' in actor.roles`",
          'default',
        ]);
      }
      const available = Object.keys(fields).join(', ');
      return this.err(
        obj.kind === 'feature' ? 'no_property_on_type' : 'no_property_on_record',
        `no property '${field}' on ${owner}`,
        span,
        {
          field,
          ...(obj.kind === 'feature' ? { type: obj.type } : {}),
          ...(near ? { near } : { available }),
        },
        near
          ? [`did you mean '${near}'?`, 'near']
          : [`available: ${available || '(none)'}`, available === '' ? 'none' : 'available'],
      );
    }
    if (obj.kind === 'list') {
      return this.err('list_field', `cannot read '${field}' of a list`, span, { field }, [
        `use a macro over the list, e.g. .exists(x, x.${field} == ...)`,
        'default',
      ]);
    }
    return this.err('cannot_read_field', `cannot read '${field}' of ${show(obj)}`, span, {
      field,
      actual: show(obj),
    });
  }

  private member(e: MemberNode, scope: Scope | undefined): Ty {
    const obj = this.infer(e.object, scope);
    return this.selectField(obj, e.field, e.span);
  }

  private index(e: Extract<Expr, { kind: 'index' }>, scope: Scope | undefined): Ty {
    const obj = this.infer(e.object, scope);
    const idx = this.infer(e.index, scope);
    if (isDyn(obj)) return T.dyn;
    if (obj.kind === 'list') {
      this.expectTy(idx, T.int, e.index.span, 'a list index', 'list_index_type');
      return obj.element;
    }
    if (obj.kind === 'map') {
      this.expectTy(idx, obj.key, e.index.span, 'a map key', 'map_lookup_type');
      return obj.value;
    }
    if (obj.kind === 'record' || obj.kind === 'feature') {
      if (e.index.kind === 'literal' && e.index.type === 'string')
        return this.selectField(obj, e.index.value as string, e.index.span);
      return this.err('record_index', 'a record is indexed with a string literal', e.index.span, {}, [
        'write .name instead',
        'default',
      ]);
    }
    return this.err('cannot_index', `cannot index ${show(obj)}`, e.span, { actual: show(obj) });
  }

  private has(e: HasNode, scope: Scope | undefined): Ty {
    const obj = this.infer(e.select.object, scope);
    if (obj.kind === 'record' || obj.kind === 'feature') {
      this.types.set(e.select, this.selectField(obj, e.select.field, e.select.span));
    } else this.types.set(e.select, T.dyn);
    if (obj.kind === 'record' || obj.kind === 'feature') return T.bool;
    if (!isDyn(obj) && obj.kind !== 'map')
      this.err('has_operand', `has() needs a record or map but got ${show(obj)}`, e.select.object.span, {
        actual: show(obj),
      });
    return T.bool;
  }

  private comprehension(e: ComprehensionNode, scope: Scope | undefined): Ty {
    const range = this.infer(e.range, scope);
    let el: Ty = T.dyn;
    if (range.kind === 'list') el = range.element;
    else if (range.kind === 'map') el = range.key;
    else if (!isDyn(range)) {
      this.err('macro_range', `${e.macro}() needs a list but got ${show(range)}`, e.range.span, {
        macro: e.macro,
        actual: show(range),
      });
    }
    const body = this.infer(e.body, { name: e.variable, ty: el, parent: scope });
    if (e.macro === 'map') return listOf(body);
    this.expectTy(body, T.bool, e.body.span, `the predicate of ${e.macro}()`, 'predicate_type', {
      macro: e.macro,
    });
    return e.macro === 'filter' ? listOf(el) : T.bool;
  }

  private binary(op: string, l: Ty, r: Ty, span: Span): Ty {
    return binaryType(op, l, r, (code, why) =>
      this.err(code, `operator '${op}' ${why} (${show(l)} and ${show(r)})`, span, {
        op,
        left: show(l),
        right: show(r),
      }),
    );
  }

  private call(e: CallNode, scope: Scope | undefined): Ty {
    const target = e.target ? this.infer(e.target, scope) : undefined;
    const args = e.args.map((a) => this.infer(a, scope));
    if (!e.target && (HISTORY_FUNCTIONS as readonly string[]).includes(e.name)) return checkHistory(this, e);
    const ty = checkCall(this, e, target, args);
    if (e.name === 'matches') checkMatchesPattern(this, e);
    return ty;
  }
}

/** Type-checks `ast` against `env`. Collects every error; never throws. */
export function check(ast: Expr, env: Env, options: CheckOptions = {}): CheckResult {
  const c = new Checker(env);
  const type = c.infer(ast, undefined);
  if (options.expect && !assignable(type, options.expect)) {
    c.errors.push({
      code: 'result_type',
      message: `expected ${show(options.expect)} but the expression is ${show(type)}`,
      span: ast.span,
      params: { expected: show(options.expect), actual: show(type) },
    });
  }
  if (c.errors.length > 0) return { ok: false, errors: c.errors };
  return { ok: true, typed: { ast, type, types: c.types } };
}
