/**
 * Hand-written recursive-descent parser for the CEL subset (docs/06-rule-language.md).
 * Pure and total: `parse` never throws, returns errors with source spans and codes, and does no I/O.
 * Input is bounded by `ParseLimits` (H4).
 */
import { PARSE_LIMITS, type Expr, type MapEntry, type MemberNode, type ParseLimits, type Span } from '../ast';
import { EXPR_MACROS, type ExprBinaryOperator, type ExprMacro } from '../../registry';
import { type ExprErrorCode, type ExprErrorParams } from '../../registry/expr-errors';
import type { CodedParseResult } from './errors';
import { describe, foundParams, ParseFailure } from './failure';
import { isReservedWord, tokenize, type Token } from './lexer';

const REL_OPS = new Set(['==', '!=', '<', '<=', '>', '>=']);
const ADD_OPS = new Set(['+', '-']);
const MUL_OPS = new Set(['*', '/', '%']);

class Parser {
  private pos = 0;
  private depth = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly limits: ParseLimits,
  ) {}

  private get tok(): Token {
    return this.tokens[this.pos] as Token;
  }

  private fail(
    code: ExprErrorCode,
    message: string,
    params: ExprErrorParams = {},
    span: Span = this.tok.span,
  ): never {
    throw new ParseFailure({ code, message, params, span });
  }

  private tooDeep(): never {
    return this.fail('nested_too_deep', `expression is nested deeper than ${this.limits.maxDepth} levels`, {
      max: this.limits.maxDepth,
    });
  }

  private isPunct(text: string): boolean {
    return this.tok.kind === 'punct' && this.tok.text === text;
  }

  private isIdent(name: string): boolean {
    return this.tok.kind === 'ident' && this.tok.text === name;
  }

  private next(): Token {
    const t = this.tok;
    if (t.kind !== 'eof') this.pos++;
    return t;
  }

  private expect(text: string, what = `'${text}'`): Token {
    if (!this.isPunct(text)) {
      this.fail('expected_punct', `expected ${what} but found ${describe(this.tok)}`, {
        expected: text,
        ...foundParams(this.tok),
      });
    }
    return this.next();
  }

  /** A non-reserved, non-keyword name. */
  private name(what: string): Token {
    const t = this.tok;
    if (t.kind !== 'ident') {
      this.fail('expected_field_name', `expected ${what} but found ${describe(t)}`, foundParams(t));
    }
    if (isReservedWord(t.text)) {
      this.fail('reserved_word', `'${t.text}' is a reserved word and cannot be used as a name`, {
        name: t.text,
      });
    }
    if (t.text === 'in' || t.text === 'true' || t.text === 'false' || t.text === 'null') {
      this.fail('keyword_as_name', `'${t.text}' is a keyword and cannot be used as a name`, {
        name: t.text,
      });
    }
    return this.next();
  }

  parseAll(): Expr {
    const e = this.expr();
    if (this.tok.kind !== 'eof') {
      if (this.isPunct('{')) {
        this.fail('struct_unsupported', 'message construction and struct literals are not supported');
      }
      this.fail('unexpected_token', `unexpected ${describe(this.tok)}`, foundParams(this.tok));
    }
    return e;
  }

  private guarded<T>(f: () => T): T {
    if (++this.depth > this.limits.maxDepth) {
      this.tooDeep();
    }
    try {
      return f();
    } finally {
      this.depth--;
    }
  }

  private expr(): Expr {
    return this.guarded(() => {
      const test = this.binaryLevel(0);
      if (!this.isPunct('?')) return test;
      this.next();
      const then = this.binaryLevel(0);
      this.expect(':');
      const other = this.expr();
      return {
        kind: 'conditional',
        test,
        then,
        else: other,
        span: { start: test.span.start, end: other.span.end },
      };
    });
  }

  private static readonly LEVELS: readonly (readonly string[])[] = [['||'], ['&&']];

  private binary(op: string, left: Expr, right: Expr): Expr {
    return {
      kind: 'binary',
      op: op as ExprBinaryOperator,
      left,
      right,
      span: { start: left.span.start, end: right.span.end },
    };
  }

  private binaryLevel(level: number): Expr {
    if (level === 0 || level === 1) {
      const op = (Parser.LEVELS[level] as readonly string[])[0] as string;
      let left = this.binaryLevel(level + 1);
      while (this.isPunct(op)) {
        this.next();
        left = this.binary(op, left, this.binaryLevel(level + 1));
      }
      return left;
    }
    return this.relation();
  }

  private relation(): Expr {
    let left = this.additive();
    for (;;) {
      const t = this.tok;
      const isOp = (t.kind === 'punct' && REL_OPS.has(t.text)) || (t.kind === 'ident' && t.text === 'in');
      if (!isOp) return left;
      this.next();
      left = this.binary(t.text, left, this.additive());
    }
  }

  private additive(): Expr {
    let left = this.multiplicative();
    while (this.tok.kind === 'punct' && ADD_OPS.has(this.tok.text)) {
      const op = this.next().text;
      left = this.binary(op, left, this.multiplicative());
    }
    return left;
  }

  private multiplicative(): Expr {
    let left = this.unary();
    while (this.tok.kind === 'punct' && MUL_OPS.has(this.tok.text)) {
      const op = this.next().text;
      left = this.binary(op, left, this.unary());
    }
    return left;
  }

  private unary(): Expr {
    if (this.isPunct('!') || this.isPunct('-')) {
      return this.guarded(() => {
        const opTok = this.next();
        const numeric = this.tok.kind === 'int' || this.tok.kind === 'double';
        const operand = this.unary();
        const span = { start: opTok.span.start, end: operand.span.end };
        if (
          opTok.text === '-' &&
          numeric &&
          operand.kind === 'literal' &&
          (operand.type === 'int' || operand.type === 'double')
        ) {
          return { ...operand, value: -(operand.value as number), span };
        }
        return { kind: 'unary', op: opTok.text as '!' | '-', operand, span };
      });
    }
    return this.member();
  }

  private member(): Expr {
    const base = this.depth;
    try {
      return this.postfix(this.primary());
    } finally {
      this.depth = base;
    }
  }

  /** Each postfix link (`.f`, `[i]`, `.f()`) nests one level deeper in the tree, so it counts toward depth. */
  private postfix(start: Expr): Expr {
    let e = start;
    for (;;) {
      if (this.isPunct('.') || this.isPunct('[')) {
        if (++this.depth > this.limits.maxDepth) {
          this.tooDeep();
        }
      }
      if (this.isPunct('.')) {
        this.next();
        const field = this.name("a field name after '.'");
        if (this.isPunct('(')) {
          e = this.receiverCall(e, field);
        } else {
          e = {
            kind: 'member',
            object: e,
            field: field.text,
            span: { start: e.span.start, end: field.span.end },
          };
        }
      } else if (this.isPunct('[')) {
        this.next();
        const index = this.expr();
        const close = this.expect(']');
        e = { kind: 'index', object: e, index, span: { start: e.span.start, end: close.span.end } };
      } else {
        return e;
      }
    }
  }

  private args(): { args: Expr[]; end: number } {
    this.expect('(');
    const args: Expr[] = [];
    if (!this.isPunct(')')) {
      do args.push(this.expr());
      while (this.isPunct(',') && this.next());
    }
    return { args, end: this.expect(')', "')' to close the call").span.end };
  }

  private receiverCall(target: Expr, nameTok: Token): Expr {
    const { args, end } = this.args();
    const span = { start: target.span.start, end };
    if (!EXPR_MACROS.has(nameTok.text)) return { kind: 'call', name: nameTok.text, target, args, span };
    const macro = nameTok.text as ExprMacro;
    const [variable, body] = args;
    if (args.length !== 2 || variable?.kind !== 'ident' || body === undefined) {
      this.fail(
        'macro_arguments',
        `${macro}() takes a variable name and one expression, e.g. list.${macro}(x, x > 1)`,
        { macro },
        span,
      );
    }
    return { kind: 'comprehension', macro, range: target, variable: variable.name, body, span };
  }

  private primary(): Expr {
    const t = this.tok;
    switch (t.kind) {
      case 'int':
      case 'double':
      case 'string':
        this.next();
        return {
          kind: 'literal',
          type: t.kind === 'string' ? 'string' : t.kind,
          value: t.value,
          span: t.span,
        };
      case 'eof':
        return this.fail('unexpected_end', 'unexpected end of expression');
      case 'punct':
        return this.primaryPunct(t);
      case 'ident':
        return this.primaryIdent(t);
    }
  }

  private primaryPunct(t: Token): Expr {
    if (t.text === '(') {
      this.next();
      const inner = this.expr();
      const close = this.expect(')', "')' to close the parenthesis");
      return { ...inner, span: { start: t.span.start, end: close.span.end } };
    }
    if (t.text === '[') {
      this.next();
      const elements: Expr[] = [];
      while (!this.isPunct(']')) {
        elements.push(this.expr());
        if (!this.isPunct(',')) break;
        this.next();
      }
      const close = this.expect(']', "']' to close the list");
      return { kind: 'list', elements, span: { start: t.span.start, end: close.span.end } };
    }
    if (t.text === '{') {
      this.next();
      const entries: MapEntry[] = [];
      while (!this.isPunct('}')) {
        const key = this.expr();
        this.expect(':', "':' between map key and value");
        const value = this.expr();
        entries.push({ key, value, span: { start: key.span.start, end: value.span.end } });
        if (!this.isPunct(',')) break;
        this.next();
      }
      const close = this.expect('}', "'}' to close the map");
      return { kind: 'map', entries, span: { start: t.span.start, end: close.span.end } };
    }
    return this.fail('unexpected_token', `unexpected ${describe(t)}`, foundParams(t));
  }

  private primaryIdent(t: Token): Expr {
    if (t.text === 'true' || t.text === 'false') {
      this.next();
      return { kind: 'literal', type: 'bool', value: t.text === 'true', span: t.span };
    }
    if (t.text === 'null') {
      this.next();
      return { kind: 'literal', type: 'null', value: null, span: t.span };
    }
    const nameTok = this.name('an expression');
    if (!this.isPunct('(')) return { kind: 'ident', name: nameTok.text, span: nameTok.span };
    const { args, end } = this.args();
    const span = { start: nameTok.span.start, end };
    if (nameTok.text === 'has') {
      const [select] = args;
      if (args.length !== 1 || select?.kind !== 'member') {
        this.fail('has_arguments', 'has() takes one field selection, e.g. has(self.name)', {}, span);
      }
      return { kind: 'has', select: select as MemberNode, span };
    }
    return { kind: 'call', name: nameTok.text, args, span };
  }
}

export function parse(src: string, limits: ParseLimits = PARSE_LIMITS.config): CodedParseResult {
  try {
    return parseUnchecked(src, limits);
  } catch (e) {
    if (e instanceof ParseFailure) return { ok: false, errors: [e.error] };
    const span = { start: 0, end: src.length };
    return {
      ok: false,
      errors: [{ code: 'parser_internal', message: 'internal parser error', params: {}, span }],
    };
  }
}

function parseUnchecked(src: string, limits: ParseLimits): CodedParseResult {
  if (src.length > limits.maxLength) {
    return {
      ok: false,
      errors: [
        {
          code: 'too_long',
          message: `expression is longer than ${limits.maxLength} characters`,
          params: { max: limits.maxLength },
          span: { start: limits.maxLength, end: src.length },
        },
      ],
    };
  }
  const lexed = tokenize(src);
  if (!lexed.ok) return { ok: false, errors: [lexed.error] };
  return { ok: true, ast: new Parser(lexed.tokens, limits).parseAll() };
}
