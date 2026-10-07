/** How the parser reports what it found: the thrown failure, and the token as English text and as params. */
import type { ExprErrorParams } from '../../registry/expr-errors';
import type { CodedParseError } from './errors';
import type { Token } from './lexer';

export class ParseFailure extends Error {
  constructor(readonly error: CodedParseError) {
    super(error.message);
  }
}

export const describe = (t: Token): string =>
  t.kind === 'eof'
    ? 'end of expression'
    : t.kind === 'string'
      ? 'a string'
      : t.kind === 'int' || t.kind === 'double'
        ? 'a number'
        : `'${t.text}'`;

/** What the parser found, as params: `found_kind` is `end`, `string`, `number` or `token` (then `found` is its text). */
export const foundParams = (t: Token): ExprErrorParams =>
  t.kind === 'eof'
    ? { found_kind: 'end', found: '' }
    : t.kind === 'string'
      ? { found_kind: 'string', found: '' }
      : t.kind === 'int' || t.kind === 'double'
        ? { found_kind: 'number', found: '' }
        : { found_kind: 'token', found: t.text };
