import { describe, expect, it } from 'vitest';
import { PARSE_OK } from '../__fixtures__/parse-cases';
import { toSexpr } from '../__fixtures__/sexpr';
import { ENV } from '../__fixtures__/check-cases';
import { EVAL_OK, evalContext } from '../__fixtures__/eval-cases';
import { T, check, type Env, type TypedAst } from '../check';
import { condition } from '../evaluate';
import { parse } from '../parse';
import { MAX_PARTS, explain } from '.';
import { print } from './print';

function typed(src: string, env: Env = ENV): TypedAst {
  const p = parse(src, { maxLength: 1_000_000, maxDepth: 64 });
  if (!p.ok) throw new Error(`parse ${src}`);
  const c = check(p.ast, env);
  if (!c.ok) throw new Error(`check ${src}: ${c.errors[0]?.message}`);
  return c.typed;
}
const on = (self: 'b1' | 'b2') => evalContext({ self: { $feature: self as never } });

describe('explain: a failing when names the failing sub-expression', () => {
  it("self.stage != 'erledigt' on a finished tree", () => {
    const e = explain(typed("self.stage != 'erledigt'"), on('b2'));
    expect(e.value).toBe(false);
    expect(e.decisive).toHaveLength(1);
    expect(e.decisive[0]?.source).toBe("self.stage != 'erledigt'");
    expect(e.decisive[0]?.value).toBe(false);
    expect(e.text).toBe("not satisfied because self.stage != 'erledigt' is false (self.stage is 'erledigt')");
  });

  it('a conjunction names only the false conjuncts', () => {
    const src = "self.hoehe > 10 && self.stage == 'aktiv' && self.alter > 100";
    const e = explain(typed(src), on('b1'));
    expect(e.decisive.map((p) => p.source)).toEqual(['self.alter > 100']);
    expect(e.decisive[0]?.span).toEqual({ start: src.indexOf('self.alter'), end: src.length });
  });

  it('every false conjunct is named', () => {
    const e = explain(typed("self.hoehe > 100 && self.stage == 'x' && self.alter > 3"), on('b1'));
    expect(e.decisive.map((p) => p.source)).toEqual(['self.hoehe > 100', "self.stage == 'x'"]);
  });

  it('a disjunction that fails names every disjunct; one that holds names the first true one', () => {
    const no = explain(typed("self.stage == 'x' || self.hoehe > 100"), on('b1'));
    expect(no.decisive).toHaveLength(2);
    const yes = explain(typed("self.stage == 'x' || self.hoehe > 10 || self.alter > 3"), on('b1'));
    expect(yes.value).toBe(true);
    expect(yes.decisive.map((p) => p.source)).toEqual(['self.hoehe > 10']);
    expect(yes.text).toContain('satisfied because self.hoehe > 10 is true');
  });

  it('goes into a nested group and through negation', () => {
    const e = explain(typed("(self.stage == 'x' || self.hoehe > 100) && self.alter > 3"), on('b1'));
    expect(e.decisive.map((p) => p.source)).toEqual(["self.stage == 'x'", 'self.hoehe > 100']);
    const n = explain(typed("!(self.stage == 'aktiv')"), on('b1'));
    expect(n.value).toBe(false);
    expect(n.decisive.map((p) => p.source)).toEqual(["self.stage == 'aktiv'"]);
  });

  it('a missing value is reported as null, an error as an error', () => {
    const missing = explain(typed('self.notiz.size() > 0'), on('b1'));
    expect(missing.value).toBe(false);
    expect(missing.decisive[0]?.value).toBeNull();
    const err = explain(typed('self.alter / (self.alter - 40) > 1'), on('b1'));
    expect(err.value).toBe(false);
    expect(err.decisive[0]?.error).toContain('division by zero');
    expect(err.text).toContain('could not be evaluated');
  });

  it('follows the taken branch of ?:', () => {
    const e = explain(typed("self.stage == 'aktiv' ? self.hoehe > 100 : true"), on('b1'));
    expect(e.decisive.map((p) => p.source)).toEqual(["self.stage == 'aktiv'", 'self.hoehe > 100']);
  });
});

describe('explain: agrees with evaluate', () => {
  const bools = EVAL_OK.map(([s]) => s).filter((s) => {
    try {
      return typed(s).type.kind === 'bool';
    } catch {
      return false;
    }
  });
  it.each(bools)('%s', (src) => {
    const t = typed(src);
    const e = explain(t, evalContext());
    expect(e.value).toBe(condition(t, evalContext()).value);
    expect(e.decisive.length).toBeGreaterThan(0);
    expect(e.text.length).toBeGreaterThan(0);
  });
});

describe('explain: long flat chains (A-005 item 6)', () => {
  const env: Env = { ...ENV, features: { ...ENV.features, baum: { ...ENV.features.baum, a: T.int } } };
  const n = 16_000;

  it('a 16k-term || chain that fails lists the first parts and says there are more', () => {
    const src = Array.from({ length: n }, (_, i) => `self.a == ${i + 1000}`).join(' || ');
    const e = explain(typed(src, env), on('b1'));
    expect(e.value).toBe(false);
    expect(e.decisive).toHaveLength(MAX_PARTS);
    expect(e.text).toContain('and more');
  });

  it('a 16k-term && chain with one false term names it', () => {
    const src = Array.from({ length: n }, (_, i) => (i === 9_000 ? 'self.a == 1' : 'self.a != 1')).join(
      ' && ',
    );
    const e = explain(typed(src, env), evalContext());
    expect(e.decisive.map((p) => p.source)).toEqual(['self.a == 1']);
  });
});

describe('print', () => {
  it.each(PARSE_OK.map(([s]) => s))('%s prints to source that parses to the same tree', (src) => {
    const a = parse(src);
    if (!a.ok) throw new Error('corpus');
    const b = parse(print(a.ast));
    if (!b.ok) throw new Error(`${print(a.ast)}: ${b.errors[0]?.message}`);
    expect(toSexpr(b.ast)).toBe(toSexpr(a.ast));
  });

  it('prints a 16k-term chain without recursion', () => {
    const src = Array.from({ length: 16_000 }, () => 'x').join(' || ');
    const p = parse(src, { maxLength: 1_000_000, maxDepth: 64 });
    if (!p.ok) throw new Error('parse');
    expect(print(p.ast)).toBe(src);
  });
});
