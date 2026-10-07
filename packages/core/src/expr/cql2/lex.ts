/** Tokenizer for the CQL2 text encoding. Total on strings; throws `Cql2Failure` with a span. */
import type { Span } from '../ast';
import { fail } from './build';

export const TOKEN_KINDS = ['num', 'str', 'id', 'qid', 'punct', 'eof'] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export interface Token {
  readonly kind: TokenKind;
  /** Source text (for `str` and `qid`: the decoded value). */
  readonly text: string;
  readonly span: Span;
}

const PUNCT2 = new Set(['<>', '<=', '>=']);
const PUNCT1 = new Set(['=', '<', '>', '(', ')', ',', '+', '-', '*', '/', '%', '^']);
const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT = /^[\p{L}_][\p{L}\p{N}_:.]*/u;

/** Reads a quoted run ending at the matching `quote`; a doubled quote stands for one quote. */
function quoted(src: string, start: number, quote: string, what: string): Token {
  let out = '';
  let i = start + 1;
  for (;;) {
    if (i >= src.length) return fail(`unterminated ${what}`, { start, end: src.length });
    const c = src.charAt(i);
    if (c === quote) {
      if (src.charAt(i + 1) === quote) {
        out += quote;
        i += 2;
        continue;
      }
      return { kind: quote === "'" ? 'str' : 'qid', text: out, span: { start, end: i + 1 } };
    }
    out += c;
    i++;
  }
}

export function tokenize(src: string): readonly Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const t = quoted(src, i, c, c === "'" ? 'string' : 'quoted name');
      tokens.push(t);
      i = t.span.end;
      continue;
    }
    const rest = src.slice(i);
    const n = NUMBER.exec(rest);
    if (n) {
      tokens.push({ kind: 'num', text: n[0], span: { start: i, end: i + n[0].length } });
      i += n[0].length;
      continue;
    }
    const id = IDENT.exec(rest);
    if (id) {
      tokens.push({ kind: 'id', text: id[0], span: { start: i, end: i + id[0].length } });
      i += id[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    const punct = PUNCT2.has(two) ? two : PUNCT1.has(c) ? c : null;
    if (punct === null) return fail(`unexpected character '${c}'`, { start: i, end: i + 1 });
    tokens.push({ kind: 'punct', text: punct, span: { start: i, end: i + punct.length } });
    i += punct.length;
  }
  tokens.push({ kind: 'eof', text: '', span: { start: src.length, end: src.length } });
  return tokens;
}
