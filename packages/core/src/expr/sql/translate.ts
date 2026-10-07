/**
 * The translator behind `toSql`. Parts of an expression that do not read a row are folded to a constant with
 * `evaluate` (so `actor.kind`, `now - days(30)` or `date('2026-01-01')` become one bound parameter and the
 * two backends cannot disagree on them); the rest is written as SQL. Left-associative chains are walked with a
 * loop, and runs of `&&` or `||` are combined as a balanced tree so SQLite's expression depth limit (1000) is
 * no problem for a 16k-term chain.
 */
import type { Json } from '../../model';
import type { BinaryNode, CallNode, ComprehensionNode, Expr, HasNode, IndexNode, MemberNode } from '../ast';
import type { TypedAst } from '../check/check';
import { T } from '../check/ty';
import type { Ty } from '../check/types';
import type { EvalContext, EvalValue } from '../contract';
import { evaluate } from '../evaluate';
import type { SqlArg } from '../functions/define';
import { FUNCTIONS } from '../functions';
import type { SqlMapping } from './contract';
import { SqlUnsupported, bind, cat, raw, unsupported, type Frag } from './frag';
import { NO_FEATURES, NO_GEO } from './noports';
import { addMonthsFrag, balanced, monthsArg, collapseEquals, inListOf, type Equalities } from './logic';
import { binarySql, impliedNotNull, not, unaryMinus } from './ops';
import { analyse } from './analysis';
import { boolPropFrag, fromRoot, relationFrom, safeKey, sqlOf, type Row, type Val } from './values';
import { systemFrag } from './system';

/** Longest non-logical operator chain: SQLite refuses expression trees deeper than 1000. */
const MAX_CHAIN = 400;

const isLogical = (op: string): op is '&&' | '||' => op === '&&' || op === '||';

interface Run {
  readonly op: '&&' | '||';
  readonly items: Frag[];
}

/** One `FROM ... WHERE <base>` over the range of a comprehension, and what its variable stands for. */
interface Range {
  readonly from: Frag;
  readonly variable: Val;
  /** Wraps a query so it can be read from the root row (a range hanging off a relation of a relation). */
  readonly reach: (q: Frag) => Frag;
}

export class Translator {
  private n = 0;
  private readonly dep: Set<Expr>;
  private readonly fails: Set<Expr>;
  private readonly types: ReadonlyMap<Expr, Ty>;
  private readonly evalCtx: EvalContext;
  private scope = new Map<string, Val>();
  /** Fragments that are `x == constant` (identity is the key), so a run of them can collapse to `IN`. */
  private readonly equals: Equalities = new WeakMap();

  constructor(
    typed: TypedAst,
    private readonly mapping: SqlMapping,
  ) {
    this.types = typed.types;
    ({ dep: this.dep, fails: this.fails } = analyse(typed.ast, mapping.vars, typed.types));
    const now = mapping.vars.get('now');
    this.evalCtx = {
      vars: new Map<string, EvalValue>(mapping.vars),
      features: NO_FEATURES,
      now: typeof now === 'string' ? now : '',
      relations: new Map(),
      geo: mapping.geo ?? NO_GEO,
    };
  }

  readonly fresh = (): string => `_t${++this.n}`;
  private ty = (e: Expr): Ty => this.types.get(e) ?? T.dyn;

  translate(ast: Expr): Frag {
    return sqlOf(this.tr(ast), this.fresh);
  }

  private tr(e: Expr): Val {
    try {
      return this.node(e);
    } catch (x) {
      if (x instanceof SqlUnsupported && x.span === undefined) throw new SqlUnsupported(x.reason, e.span);
      throw x;
    }
  }

  private node(e: Expr): Val {
    if (!this.dep.has(e)) return this.fold(e);
    switch (e.kind) {
      case 'ident':
        return this.ident(e.name);
      case 'member':
        return this.member(e);
      case 'index':
        return this.index(e);
      case 'call':
        return this.call(e);
      case 'has':
        return this.has(e);
      case 'comprehension':
        return this.comprehension(e);
      case 'unary': {
        const operand = this.tr(e.operand);
        if (e.op === '!') return { k: 'sql', f: not(this.boolOf(operand, e.operand)), ty: T.bool };
        return { k: 'sql', f: unaryMinus(sqlOf(operand, this.fresh), this.ty(e.operand)), ty: this.ty(e) };
      }
      case 'binary':
        return this.binary(e);
      case 'conditional': {
        const t = this.boolOf(this.tr(e.test), e.test);
        const a = sqlOf(this.tr(e.then), this.fresh);
        const b = sqlOf(this.tr(e.else), this.fresh);
        // a null test gives null, as in the rule language (a plain CASE would take the else branch)
        return {
          k: 'sql',
          f: cat('(CASE WHEN ', t, ' THEN ', a, ' WHEN NOT ', t, ' THEN ', b, ' END)'),
          ty: this.ty(e),
        };
      }
      case 'literal':
      case 'list':
      case 'map':
        return unsupported('a list or map that holds stored values');
    }
  }

  /**
   * An operand that must be a bool. A stored value of unknown type (`self.meta.ok`) counts only when it is a
   * JSON true or false; anything else is null here, and null and an evaluation error both mean "does not hold".
   */
  private boolOf(v: Val, node: Expr): Frag {
    const kind = this.ty(node).kind;
    if (kind === 'bool') return sqlOf(v, this.fresh);
    if (kind === 'dyn' && v.k === 'prop') return boolPropFrag(v.base, v.path, this.fresh);
    return unsupported('an operand that is not statically a bool');
  }

  private fold(e: Expr): Val {
    if (e.kind === 'literal') return { k: 'const', v: e.value, ty: this.ty(e) }; // hot in long OR-lists
    const r = evaluate({ ast: e, type: this.ty(e), types: this.types }, this.evalCtx);
    if (!r.ok) return unsupported(`constant part fails: ${r.error.message}`);
    const v = r.value;
    if (typeof v === 'object' && v !== null && !Array.isArray(v) && '$feature' in v)
      return unsupported('a feature reference');
    return { k: 'const', v: v as Json, ty: this.ty(e) };
  }

  private ident(name: string): Val {
    const local = this.scope.get(name);
    if (local !== undefined) return local;
    if (name === 'self') return { k: 'row', row: { kind: 'root', alias: this.mapping.self } };
    if (name === 'other') {
      if (this.mapping.other === undefined) return unsupported("'other' is not bound in this query");
      return { k: 'row', row: { kind: 'root', alias: this.mapping.other } };
    }
    return unsupported(`'${name}' is not available in SQL`);
  }

  /** The key an inverse relation's edges are stored under, or undefined for a relation read forwards. */
  private storedInverse(owner: Expr, field: string): string | undefined {
    const t = this.ty(owner);
    return t.kind === 'feature' ? this.mapping.inverse?.get(`${t.type}.${field}`) : undefined;
  }

  private relation(row: Row, owner: Expr, field: string, many: boolean): Val {
    const stored = this.storedInverse(owner, field);
    const inverse = stored !== undefined;
    const relation = stored ?? field;
    if (many) return { k: 'rows', parent: row, relation, inverse };
    const rel: Row = { kind: 'rel', alias: this.fresh(), parent: row, relation, inverse };
    return { k: 'row', row: rel };
  }

  private member(e: MemberNode): Val {
    return this.access(this.tr(e.object), e.field, e);
  }

  private access(obj: Val, field: string, e: MemberNode | IndexNode): Val {
    const ty = this.ty(e);
    if (obj.k === 'row') {
      const system = systemFrag(obj.row, field, this.fresh);
      if (system !== undefined) return { k: 'sql', f: system, ty };
      if (ty.kind === 'feature') return this.relation(obj.row, e.object, field, false);
      if (ty.kind === 'list' && ty.element.kind === 'feature')
        return this.relation(obj.row, e.object, field, true);
      return { k: 'prop', base: obj.row, path: [safeKey(field)], ty };
    }
    if (obj.k === 'prop') return { k: 'prop', base: obj.base, path: [...obj.path, safeKey(field)], ty };
    return unsupported('member access on a value that is not a stored property');
  }

  private index(e: IndexNode): Val {
    const obj = this.tr(e.object);
    const i = this.tr(e.index);
    if (i.k !== 'const') return unsupported('an index that is not constant');
    if (typeof i.v === 'string') return this.access(obj, i.v, e);
    if (obj.k === 'prop' && typeof i.v === 'number' && Number.isInteger(i.v) && i.v >= 0)
      return { k: 'prop', base: obj.base, path: [...obj.path, i.v], ty: this.ty(e) };
    return unsupported('an index that is not a name or a non-negative position');
  }

  private has(e: HasNode): Val {
    const sel = e.select;
    const obj = this.tr(sel.object);
    const t = this.ty(sel);
    if (obj.k === 'row' && (t.kind === 'feature' || t.kind === 'list')) {
      const stored = this.storedInverse(sel.object, sel.field);
      const from = relationFrom(
        obj.row,
        stored ?? safeKey(sel.field),
        stored !== undefined,
        this.fresh(),
        this.fresh(),
      );
      return { k: 'sql', f: fromRoot(obj.row, cat('EXISTS(SELECT 1 ', from, ')'), this.fresh), ty: T.bool };
    }
    const v = this.access(obj, sel.field, sel);
    if (v.k !== 'prop') return unsupported('has() of this value');
    return { k: 'sql', f: cat('(', sqlOf(v, this.fresh), ' IS NOT NULL)'), ty: T.bool };
  }

  private call(e: CallNode): Val {
    const nodes = e.target === undefined ? e.args : [e.target, ...e.args];
    if (e.name === 'size' && nodes.length === 1) {
      const counted = this.count(nodes[0] as Expr);
      if (counted !== undefined) return { k: 'sql', f: counted, ty: T.int };
    }
    const def = FUNCTIONS.get(e.name);
    if (def === undefined) return unsupported(`unknown function '${e.name}'`);
    if (def.sql === undefined) return unsupported(`'${e.name}' has no SQL encoding (evaluate it in core)`);
    const args: SqlArg[] = nodes.map((n) => {
      const v = this.tr(n);
      return { frag: sqlOf(v, this.fresh), ty: this.ty(n), literal: v.k === 'const' ? v.v : undefined };
    });
    return { k: 'sql', f: def.sql({ args, self: this.mapping.self }), ty: this.ty(e) };
  }

  /** `size()` of a relation set or of `set.filter(x, p)` is a count query; anything else is a plain call. */
  private count(operand: Expr): Frag | undefined {
    if (operand.kind === 'comprehension' && operand.macro === 'filter' && this.dep.has(operand)) {
      const r = this.range(operand);
      const body = this.body(operand, r);
      return r.reach(cat('(SELECT count(*) ', r.from, ' AND (', body, '))'));
    }
    if (!this.dep.has(operand)) return undefined;
    const v = this.tr(operand);
    if (v.k !== 'rows') return undefined;
    const r = this.rowsRange(v);
    return r.reach(cat('(SELECT count(*) ', r.from, ')'));
  }

  private rowsRange(v: Extract<Val, { k: 'rows' }>): Range {
    const alias = this.fresh();
    const from = relationFrom(v.parent, v.relation, v.inverse, alias, this.fresh());
    const reach = (q: Frag) => fromRoot(v.parent, q, this.fresh);
    return { from, variable: { k: 'row', row: { kind: 'root', alias } }, reach };
  }

  private range(e: ComprehensionNode): Range {
    const r = this.tr(e.range);
    if (r.k === 'rows') return this.rowsRange(r);
    let list: Frag;
    let element: Ty = T.dyn;
    if (r.k === 'const' && Array.isArray(r.v)) {
      list = bind(JSON.stringify(r.v));
      element = r.ty.kind === 'list' ? r.ty.element : T.dyn;
    } else if ((r.k === 'prop' || r.k === 'sql') && r.ty.kind === 'list') {
      list = sqlOf(r, this.fresh);
      element = r.ty.element;
    } else return unsupported('a comprehension over something that is not a list or a relation set');
    const j = this.fresh();
    return {
      from: cat('FROM json_each(', list, ') ', j, ' WHERE 1'),
      variable: { k: 'sql', f: raw(`${j}.value`), ty: element },
      reach: (q) => q,
    };
  }

  private body(e: ComprehensionNode, r: Range): Frag {
    const saved = this.scope;
    this.scope = new Map(saved).set(e.variable, r.variable);
    try {
      return this.boolOf(this.tr(e.body), e.body);
    } finally {
      this.scope = saved;
    }
  }

  private comprehension(e: ComprehensionNode): Val {
    if (e.macro !== 'exists' && e.macro !== 'all')
      return unsupported(`${e.macro}() as a value (only size(x.filter(...)) has SQL)`);
    const r = this.range(e);
    const body = this.body(e, r);
    const some = (test: string) => cat('EXISTS(SELECT 1 ', r.from, ' AND (', body, ')', test, ')');
    const f =
      e.macro === 'exists'
        ? cat('(CASE WHEN ', some(''), ' THEN 1 WHEN ', some(' IS NULL'), ' THEN NULL ELSE 0 END)')
        : cat('(CASE WHEN ', some(' = 0'), ' THEN 0 WHEN ', some(' IS NULL'), ' THEN NULL ELSE 1 END)');
    return { k: 'sql', f: r.reach(f), ty: T.bool };
  }

  private binary(top: BinaryNode): Val {
    const spine: BinaryNode[] = [];
    let cur: Expr = top;
    while (cur.kind === 'binary' && this.dep.has(cur)) {
      spine.push(cur);
      cur = cur.left;
    }
    spine.reverse();
    let acc: Val = this.tr(cur);
    let run: Run | undefined;
    let plain = 0;
    const flush = (): Val => {
      if (run !== undefined) {
        const items = run.op === '||' ? collapseEquals(run.items, this.equals) : run.items;
        acc = { k: 'sql', f: balanced(items, run.op === '&&' ? 'AND' : 'OR'), ty: T.bool };
        run = undefined;
      }
      return acc;
    };
    for (const node of spine) {
      const months = monthsArg(node, this.ty(node.left));
      if (months !== undefined) {
        if (++plain > MAX_CHAIN) return unsupported(`an operator chain longer than ${MAX_CHAIN} terms`);
        const n = sqlOf(this.tr(months), this.fresh);
        const ts = sqlOf(flush(), this.fresh);
        acc = { k: 'sql', f: addMonthsFrag(ts, n, node.op), ty: T.timestamp };
        continue;
      }
      const right = this.tr(node.right);
      if (isLogical(node.op)) {
        if (run?.op !== node.op) {
          const left = flush();
          run = { op: node.op, items: [this.boolOf(left, node.left)] };
        }
        run.items.push(this.boolOf(right, node.right));
        continue;
      }
      if (++plain > MAX_CHAIN) return unsupported(`an operator chain longer than ${MAX_CHAIN} terms`);
      acc = this.step(node, flush(), right);
    }
    return flush();
  }

  private step(node: BinaryNode, a: Val, b: Val): Val {
    const { op } = node;
    if (op === 'in') return this.memberIn(node, a, b);
    if ((op === '==' || op === '!=') && (this.fails.has(node.left) || this.fails.has(node.right)))
      return unsupported(
        'comparing a value that can fail (division by a stored value, untyped JSON arithmetic)',
      );
    if ((op === '==' || op === '!=') && a.k === 'row' && b.k === 'row') {
      if (a.row.kind !== 'root' || b.row.kind !== 'root') return unsupported('comparing related features');
      const f = raw(`(${a.row.alias}.id ${op === '==' ? 'IS' : 'IS NOT'} ${b.row.alias}.id)`);
      return { k: 'sql', f, ty: T.bool };
    }
    const l = sqlOf(a, this.fresh);
    const eq = binarySql(op, { l, r: sqlOf(b, this.fresh), lt: this.ty(node.left), rt: this.ty(node.right) });
    const constant = op === '==' && b.k === 'const' && (typeof b.v === 'string' || typeof b.v === 'number');
    const f = constant ? impliedNotNull(eq, l) : eq;
    if (constant && a.k !== 'const' && b.k === 'const')
      this.equals.set(f, { x: l, v: b.v as string | number });
    return { k: 'sql', f, ty: this.ty(node) };
  }

  /** `x in list`: a constant list becomes `IN (?, ...)`, a stored list `json_each`. Null is never in a list here. */
  private memberIn(node: BinaryNode, a: Val, b: Val): Val {
    if (this.fails.has(node.left)) return unsupported("'in' with a left side that can fail");
    const x = sqlOf(a, this.fresh);
    if (b.k === 'const' && Array.isArray(b.v)) {
      if (b.v.some((el) => el === null || typeof el === 'object'))
        return unsupported('a list of null or nested values');
      const items = b.v.map((el) => sqlOf({ k: 'const', v: el, ty: T.dyn }, this.fresh));
      return { k: 'sql', f: inListOf(x, items), ty: T.bool };
    }
    if ((b.k === 'prop' || b.k === 'sql') && this.ty(node.right).kind === 'list') {
      const j = this.fresh();
      const f = cat(
        'EXISTS(SELECT 1 FROM json_each(',
        sqlOf(b, this.fresh),
        ') ',
        j,
        ` WHERE ${j}.value IS `,
        x,
        ')',
      );
      return { k: 'sql', f, ty: T.bool };
    }
    return unsupported("'in' over something other than a list");
  }
}
