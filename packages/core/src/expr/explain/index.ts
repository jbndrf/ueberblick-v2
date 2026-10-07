/**
 * `explain(typed, ctx)`: why a condition holds or does not, naming the smallest sub-expressions that
 * decided it ("not satisfied because self.stage != 'erledigt' is false (self.stage is 'erledigt')").
 * It evaluates sub-expressions with `evaluate`, so it can never disagree with the real outcome, and it
 * walks flat `&&`/`||` chains with a loop, evaluating lazily and stopping at `MAX_PARTS`.
 */
import type { Json } from '../../model';
import type { BinaryNode, Expr } from '../ast';
import type { TypedAst } from '../check/check';
import { T } from '../check/ty';
import type { EvalContext, EvalResult } from '../contract';
import { condition, evaluate } from '../evaluate';
import type { ExplainPart, Explanation } from '../sql/contract';
import { print, quote } from './print';
import { readsOnlyActor } from './actor-only';

/** More decisive parts than this are counted, not listed. */
export const MAX_PARTS = 8;

const COMPARISONS = new Set(['==', '!=', '<', '<=', '>', '>=', 'in']);

function show(v: Json): string {
  return typeof v === 'string' ? quote(v) : v === null ? 'null' : JSON.stringify(v);
}

class Explainer {
  readonly parts: ExplainPart[] = [];
  more = false;

  constructor(
    private readonly typed: TypedAst,
    private readonly ctx: EvalContext,
  ) {}

  run(e: Expr): EvalResult {
    return evaluate({ ast: e, type: this.typed.types.get(e) ?? T.dyn, types: this.typed.types }, this.ctx);
  }

  private json(r: EvalResult): Json {
    return r.ok ? (r.value as Json) : null;
  }

  private add(part: ExplainPart): void {
    if (this.parts.length < MAX_PARTS) this.parts.push(part);
    else this.more = true;
  }

  private leaf(e: Expr, r: EvalResult): void {
    const base = { span: e.span, source: print(e), value: this.json(r), actorOnly: readsOnlyActor(e) };
    this.add(r.ok ? { ...base, ...this.detail(e) } : { ...base, error: r.error.message });
  }

  /** For a comparison, the values of the operands that are not literals. */
  private detail(e: Expr): { detail?: string } {
    if (e.kind !== 'binary' || !COMPARISONS.has(e.op)) return {};
    const shown = [e.left, e.right]
      .filter((x) => x.kind !== 'literal')
      .map((x) => {
        const r = this.run(x);
        return `${print(x)} is ${r.ok ? show(r.value as Json) : 'an error'}`;
      });
    return shown.length === 0 ? {} : { detail: shown.join(', ') };
  }

  /** The operands of a flat chain of one logical operator, left to right. */
  private operands(top: BinaryNode): Expr[] {
    const out: Expr[] = [];
    let cur: Expr = top;
    while (cur.kind === 'binary' && cur.op === top.op) {
      out.push(cur.right);
      cur = cur.left;
    }
    out.push(cur);
    return out.reverse();
  }

  /** Records the parts of `e` that decided its result `r`. */
  decide(e: Expr, r: EvalResult): void {
    if (this.parts.length >= MAX_PARTS) {
      this.more = true;
      return;
    }
    if (e.kind === 'unary' && e.op === '!') return this.decide(e.operand, this.run(e.operand));
    if (e.kind === 'binary' && (e.op === '&&' || e.op === '||')) return this.chain(e, r);
    if (e.kind === 'conditional') {
      const t = this.run(e.test);
      this.decide(e.test, t);
      const branch = t.ok && t.value === true ? e.then : e.else;
      return this.decide(branch, this.run(branch));
    }
    this.leaf(e, r);
  }

  private chain(e: BinaryNode, r: EvalResult): void {
    // `settling` is the value that decides a chain alone: true for `||`, false for `&&`
    const settling = e.op === '||';
    const operands = this.operands(e);
    const definite = r.ok && typeof r.value === 'boolean';
    const settled = definite && r.value === settling;
    for (const operand of operands) {
      if (this.parts.length >= MAX_PARTS) {
        this.more = true;
        return;
      }
      const v = this.run(operand);
      const isSettling = v.ok && v.value === settling;
      const isOther = v.ok && v.value === !settling;
      // settled: only settling operands are decisive; otherwise every operand that is not plainly the other value
      if (settled ? !isSettling : !definite && isOther) continue;
      this.decide(operand, v);
      if (settled && settling) return; // the first true disjunct suffices
    }
  }
}

function sentence(value: boolean, ex: Explainer, error: string | undefined): string {
  const list = ex.parts.map((p) => {
    const why = p.error === undefined ? `is ${show(p.value)}` : `could not be evaluated (${p.error})`;
    return `${p.source} ${why}${p.detail === undefined ? '' : ` (${p.detail})`}`;
  });
  const more = ex.more ? ' and more' : '';
  const because = list.length === 0 ? '' : ` because ${list.join(' and ')}${more}`;
  if (error !== undefined && list.length === 0) return `not satisfied: ${error}`;
  return `${value ? 'satisfied' : 'not satisfied'}${because}`;
}

export function explain(typed: TypedAst, ctx: EvalContext): Explanation {
  const c = condition(typed, ctx);
  const ex = new Explainer(typed, ctx);
  ex.decide(typed.ast, ex.run(typed.ast));
  return { value: c.value, decisive: ex.parts, more: ex.more, text: sentence(c.value, ex, c.error?.message) };
}
