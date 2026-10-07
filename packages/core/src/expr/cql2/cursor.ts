import type { Span } from '../ast';
import { fail } from './build';
import type { Token } from './lex';

const describe = (t: Token): string =>
  t.kind === 'eof'
    ? 'end of filter'
    : t.kind === 'str'
      ? 'a string'
      : t.kind === 'num'
        ? 'a number'
        : `'${t.text}'`;

/** A read position over the tokens, with the small helpers both grammar files need. */
export class Cursor {
  private pos = 0;
  depth = 0;

  constructor(
    private readonly tokens: readonly Token[],
    readonly maxDepth: number,
  ) {}

  get tok(): Token {
    return this.tokens[this.pos] as Token;
  }

  peek(offset = 1): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)] as Token;
  }

  next(): Token {
    const t = this.tok;
    if (t.kind !== 'eof') this.pos++;
    return t;
  }

  isPunct(text: string, t: Token = this.tok): boolean {
    return t.kind === 'punct' && t.text === text;
  }

  /** An unquoted word equal to `word`, case-insensitive. */
  isWord(word: string, t: Token = this.tok): boolean {
    return t.kind === 'id' && t.text.toUpperCase() === word;
  }

  acceptWord(word: string): Token | null {
    return this.isWord(word) ? this.next() : null;
  }

  expectPunct(text: string): Token {
    if (!this.isPunct(text)) fail(`expected '${text}' but found ${describe(this.tok)}`, this.tok.span);
    return this.next();
  }

  expectWord(word: string): Token {
    if (!this.isWord(word)) fail(`expected '${word}' but found ${describe(this.tok)}`, this.tok.span);
    return this.next();
  }

  failHere(message: string, span: Span = this.tok.span): never {
    return fail(message, span);
  }

  describeHere(): string {
    return describe(this.tok);
  }

  guarded<T>(f: () => T): T {
    if (++this.depth > this.maxDepth)
      fail(`filter is nested deeper than ${String(this.maxDepth)} levels`, this.tok.span);
    try {
      return f();
    } finally {
      this.depth--;
    }
  }
}
