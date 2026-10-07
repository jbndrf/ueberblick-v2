/**
 * CQL2 text encoding -> AST. Recursive descent; depth is bounded through `Cursor.guarded`.
 *
 * boolean   := and (OR and)*        and := not (AND not)*        not := NOT not | predicate
 * predicate := additive [ cmp additive | [NOT] LIKE | [NOT] IN (..) | [NOT] BETWEEN a AND b | IS [NOT] NULL ]
 */
import type { Expr, Span } from '../ast';
import type { ExprBinaryOperator } from '../../registry';
import {
  COMPARISONS,
  between,
  binary,
  bool,
  casei,
  dateOf,
  fail,
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
import { Cursor } from './cursor';
import { tokenize, type Token } from './lex';
import { box, startsGeometry, wkt } from './wkt';

/** Words that can never be a property name in the text encoding. */
const RESERVED = new Set(['AND', 'OR', 'NOT', 'LIKE', 'IN', 'BETWEEN', 'IS', 'NULL', 'DIV']);
const join = (a: Span, b: Span): Span => ({ start: a.start, end: b.end });

class TextParser {
  constructor(private readonly c: Cursor) {}

  parseAll(): Expr {
    const e = this.or();
    if (this.c.tok.kind !== 'eof') this.c.failHere(`unexpected ${this.c.describeHere()}`);
    return e;
  }

  private or(): Expr {
    return this.c.guarded(() => {
      let left = this.and();
      while (this.c.acceptWord('OR')) left = binary('||', left, this.and());
      return left;
    });
  }

  private and(): Expr {
    let left = this.not();
    while (this.c.acceptWord('AND')) left = binary('&&', left, this.not());
    return left;
  }

  private not(): Expr {
    const kw = this.c.tok;
    if (!this.c.isWord('NOT')) return this.predicate();
    this.c.next();
    return this.c.guarded(() => {
      const x = this.not();
      return not(x, join(kw.span, x.span));
    });
  }

  private predicate(): Expr {
    const left = this.additive();
    const c = this.c;
    if (c.isWord('IS')) {
      c.next();
      const neg = c.acceptWord('NOT') !== null;
      const kw = c.expectWord('NULL');
      const test = isNull(left, join(left.span, kw.span));
      return neg ? not(test) : test;
    }
    let neg = false;
    if (
      c.isWord('NOT') &&
      (c.isWord('LIKE', c.peek()) || c.isWord('IN', c.peek()) || c.isWord('BETWEEN', c.peek()))
    ) {
      c.next();
      neg = true;
    }
    let result: Expr;
    if (c.acceptWord('LIKE')) result = like(left, this.additive());
    else if (c.acceptWord('IN')) result = this.inValues(left);
    else if (c.acceptWord('BETWEEN')) {
      const lo = this.additive();
      c.expectWord('AND');
      result = between(left, lo, this.additive());
    } else {
      const op = c.tok.kind === 'punct' ? COMPARISONS.get(c.tok.text) : undefined;
      if (op === undefined) return left;
      c.next();
      return binary(op, left, this.additive());
    }
    return neg ? not(result) : result;
  }

  private inValues(left: Expr): Expr {
    const open = this.c.expectPunct('(');
    const items = [this.additive()];
    while (this.c.isPunct(',')) {
      this.c.next();
      items.push(this.additive());
    }
    const close = this.c.expectPunct(')');
    return inList(left, items, join(open.span, close.span));
  }

  private additive(): Expr {
    let left = this.multiplicative();
    while (this.c.isPunct('+') || this.c.isPunct('-')) {
      const op = this.c.next().text;
      left = binary(op as ExprBinaryOperator, left, this.multiplicative());
    }
    return left;
  }

  private multiplicative(): Expr {
    let left = this.unary();
    for (;;) {
      const t = this.c.tok;
      if (t.kind === 'punct' && (t.text === '*' || t.text === '/' || t.text === '%')) {
        this.c.next();
        left = binary(t.text, left, this.unary());
      } else if (this.c.isPunct('^') || this.c.isWord('DIV')) {
        return fail(`operator '${t.text}' is not supported`, t.span);
      } else return left;
    }
  }

  private unary(): Expr {
    if (!this.c.isPunct('-')) return this.primary();
    const minus = this.c.next();
    if (this.c.tok.kind === 'num') {
      return this.number(this.c.next(), -1, minus.span.start);
    }
    return this.c.guarded(() => {
      const x = this.unary();
      return negate(x, join(minus.span, x.span));
    });
  }

  private number(t: Token, sign: 1 | -1, start: number = t.span.start): Expr {
    const integer = /^\d+$/.test(t.text);
    const value = sign * Number(t.text);
    if (integer && !Number.isSafeInteger(value)) return fail('integer is out of range', t.span);
    return num(value, integer ? 'int' : 'double', { start, end: t.span.end });
  }

  private primary(): Expr {
    const c = this.c;
    const t = c.tok;
    switch (t.kind) {
      case 'num':
        c.next();
        return this.number(t, 1);
      case 'str':
        c.next();
        return str(t.text, t.span);
      case 'qid':
        c.next();
        return prop(t.text, t.span);
      case 'punct': {
        if (t.text !== '(') return c.failHere(`expected a value but found ${c.describeHere()}`);
        c.next();
        const inner = this.or();
        c.expectPunct(')');
        return inner;
      }
      case 'id':
        return this.word(t);
      default:
        return c.failHere(`expected a value but found ${c.describeHere()}`);
    }
  }

  private word(t: Token): Expr {
    const c = this.c;
    const upper = t.text.toUpperCase();
    if (startsGeometry(c)) return wkt(c);
    if (c.isPunct('(', c.peek())) return this.functionCall(t, upper);
    if (RESERVED.has(upper)) return c.failHere(`expected a value but found '${t.text}'`);
    c.next();
    if (upper === 'TRUE') return bool(true, t.span);
    if (upper === 'FALSE') return bool(false, t.span);
    return prop(t.text, t.span);
  }

  private functionCall(name: Token, upper: string): Expr {
    const c = this.c;
    c.next();
    if (upper === 'BBOX' || upper === 'ENVELOPE') {
      const start = name.span.start;
      // `box` expects the name to be consumed already
      return box(c, start);
    }
    const known = upper.startsWith('S_') || upper === 'DATE' || upper === 'TIMESTAMP' || upper === 'CASEI';
    if (!known)
      return fail(unsupportedReason(name.text) ?? `function '${name.text}' is not supported`, name.span);
    const args = this.args();
    const span = join(name.span, c.peek(-1).span);
    if (upper.startsWith('S_')) return spatial(name.text, args, name.span);
    if (upper === 'DATE' || upper === 'TIMESTAMP') return this.temporalLiteral(name, args, span);
    return this.one(name, args, (x) => casei(x, span));
  }

  private args(): Expr[] {
    this.c.expectPunct('(');
    if (this.c.isPunct(')')) {
      this.c.next();
      return [];
    }
    const out = [this.or()];
    while (this.c.isPunct(',')) {
      this.c.next();
      out.push(this.or());
    }
    this.c.expectPunct(')');
    return out;
  }

  private one(name: Token, args: readonly Expr[], f: (x: Expr) => Expr): Expr {
    const [x] = args;
    if (args.length !== 1 || x === undefined) return fail(`'${name.text}' needs one argument`, name.span);
    return f(x);
  }

  private temporalLiteral(name: Token, args: readonly Expr[], span: Span): Expr {
    return this.one(name, args, (x) => {
      if (x.kind !== 'literal' || x.type !== 'string')
        return fail(`'${name.text}' needs a string literal`, x.span);
      return dateOf(x, span);
    });
  }
}

export function fromText(src: string, maxDepth: number): Expr {
  return new TextParser(new Cursor(tokenize(src), maxDepth)).parseAll();
}
