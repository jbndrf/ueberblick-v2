/**
 * Lexer for the rule-language subset (docs/06-rule-language.md). Pure, never throws:
 * a bad character or literal becomes a `ParseError` with a span.
 */
import type { Span } from '../ast';
import { SYSTEM_FIELD_SIGIL, type TokenKind } from '../../registry';
import { type ExprErrorCode, type ExprErrorParams } from '../../registry/expr-errors';
import type { CodedParseError } from './errors';

export interface Token {
  readonly kind: TokenKind;
  /** Punctuation text or identifier name; empty for literals and eof. */
  readonly text: string;
  readonly value: number | string | null;
  readonly span: Span;
}

/** CEL reserved words: they can never be used as a name. */
const RESERVED = new Set([
  'as',
  'break',
  'const',
  'continue',
  'else',
  'for',
  'function',
  'if',
  'import',
  'let',
  'loop',
  'package',
  'namespace',
  'return',
  'var',
  'void',
  'while',
]);

const PUNCT_2 = new Set(['&&', '||', '==', '!=', '<=', '>=']);
const PUNCT_1 = new Set('()[]{},.:?!<>+-*/%'.split(''));

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isHex = (c: string | undefined): boolean => c !== undefined && /^[0-9a-fA-F]$/.test(c);
const isIdentStart = (c: string | undefined): boolean => c !== undefined && /^[A-Za-z_]$/.test(c);
const isIdentPart = (c: string | undefined): boolean => c !== undefined && /^[A-Za-z0-9_]$/.test(c);

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  r: '\r',
  t: '\t',
  a: '\u0007',
  b: '\b',
  f: '\f',
  v: '\v',
  '\\': '\\',
  "'": "'",
  '"': '"',
  '`': '`',
  '?': '?',
};

export type LexResult =
  | { readonly ok: true; readonly tokens: readonly Token[] }
  | { readonly ok: false; readonly error: CodedParseError };

function fail(
  code: ExprErrorCode,
  message: string,
  start: number,
  end: number,
  params: ExprErrorParams = {},
): LexResult {
  return { ok: false, error: { message, code, params, span: { start, end: Math.max(end, start + 1) } } };
}

export function isReservedWord(name: string): boolean {
  return RESERVED.has(name);
}

/** Reads the number starting at `i`. Returns the token or an error result. */
function lexNumber(src: string, i: number): { token: Token } | { error: LexResult } {
  let j = i;
  if (src[j] === '0' && (src[j + 1] === 'x' || src[j + 1] === 'X')) {
    j += 2;
    const digitsStart = j;
    while (isHex(src[j])) j++;
    if (j === digitsStart)
      return { error: fail('hex_digits_missing', 'hex literal needs digits after 0x', i, j) };
    if (src[j] === 'u' || src[j] === 'U')
      return { error: fail('unsigned_unsupported', 'unsigned integers are not supported', i, j + 1) };
    const value = Number.parseInt(src.slice(digitsStart, j), 16);
    if (!Number.isSafeInteger(value))
      return { error: fail('int_out_of_range', 'integer literal is out of range', i, j) };
    return { token: { kind: 'int', text: '', value, span: { start: i, end: j } } };
  }
  while (isDigit(src[j])) j++;
  let isDouble = false;
  if (src[j] === '.' && isDigit(src[j + 1])) {
    isDouble = true;
    j++;
    while (isDigit(src[j])) j++;
  }
  if (src[j] === 'e' || src[j] === 'E') {
    let k = j + 1;
    if (src[k] === '+' || src[k] === '-') k++;
    if (isDigit(src[k])) {
      while (isDigit(src[k])) k++;
      isDouble = true;
      j = k;
    }
  }
  if (src[j] === 'u' || src[j] === 'U')
    return { error: fail('unsigned_unsupported', 'unsigned integers are not supported', i, j + 1) };
  if (isIdentStart(src[j]))
    return { error: fail('number_runs_into_name', 'a number must not run into a name', i, j + 1) };
  const text = src.slice(i, j);
  const value = Number(text);
  if (!Number.isFinite(value) || (!isDouble && !Number.isSafeInteger(value))) {
    return { error: fail('number_out_of_range', 'number literal is out of range', i, j) };
  }
  return { token: { kind: isDouble ? 'double' : 'int', text: '', value, span: { start: i, end: j } } };
}

/** Reads a quoted string starting at the quote at `i`. */
function lexString(src: string, i: number): { token: Token } | { error: LexResult } {
  const quote = src[i] as string;
  if (src[i + 1] === quote && src[i + 2] === quote) {
    return { error: fail('triple_quote_unsupported', 'triple-quoted strings are not supported', i, i + 3) };
  }
  let out = '';
  let j = i + 1;
  while (j < src.length) {
    const c = src[j] as string;
    if (c === quote) {
      return { token: { kind: 'string', text: '', value: out, span: { start: i, end: j + 1 } } };
    }
    if (c === '\n' || c === '\r')
      return { error: fail('string_newline', 'unterminated string (newline in string)', i, j) };
    if (c !== '\\') {
      out += c;
      j++;
      continue;
    }
    const e = src[j + 1];
    if (e === undefined) break;
    const simple = SIMPLE_ESCAPES[e];
    if (simple !== undefined) {
      out += simple;
      j += 2;
    } else if (e === 'x' || e === 'u' || e === 'U') {
      const len = e === 'x' ? 2 : e === 'u' ? 4 : 8;
      const digits = src.slice(j + 2, j + 2 + len);
      if (digits.length !== len || ![...digits].every(isHex)) {
        return {
          error: fail(
            'escape_hex_invalid',
            `invalid \\${e} escape, expected ${len} hex digits`,
            j,
            j + 2 + digits.length,
            { escape: e, digits: len },
          ),
        };
      }
      const cp = Number.parseInt(digits, 16);
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff))
        return { error: fail('escape_code_point_invalid', 'invalid code point in escape', j, j + 2 + len) };
      out += String.fromCodePoint(cp);
      j += 2 + len;
    } else {
      return { error: fail('escape_unknown', `unknown escape sequence \\${e}`, j, j + 2, { escape: e }) };
    }
  }
  return { error: fail('string_unterminated', 'unterminated string', i, src.length) };
}

export function tokenize(src: string): LexResult {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (isDigit(c)) {
      const r = lexNumber(src, i);
      if ('error' in r) return r.error;
      tokens.push(r.token);
      i = r.token.span.end;
      continue;
    }
    if (c === '"' || c === "'") {
      const r = lexString(src, i);
      if ('error' in r) return r.error;
      tokens.push(r.token);
      i = r.token.span.end;
      continue;
    }
    // A system field (`self.$created_by`, registry SYSTEM_FIELDS): `$` starts a name only straight after a `.`.
    const sigil = c === SYSTEM_FIELD_SIGIL && isIdentStart(src[i + 1]) && tokens.at(-1)?.text === '.';
    if (isIdentStart(c) || sigil) {
      let j = i + 1;
      while (isIdentPart(src[j])) j++;
      const name = src.slice(i, j);
      if (
        (name === 'r' || name === 'R' || name === 'b' || name === 'B') &&
        (src[j] === '"' || src[j] === "'")
      ) {
        return fail('raw_bytes_unsupported', 'raw and bytes literals are not supported', i, j + 1);
      }
      tokens.push({ kind: 'ident', text: name, value: null, span: { start: i, end: j } });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (PUNCT_2.has(two)) {
      tokens.push({ kind: 'punct', text: two, value: null, span: { start: i, end: i + 2 } });
      i += 2;
      continue;
    }
    if (PUNCT_1.has(c)) {
      tokens.push({ kind: 'punct', text: c, value: null, span: { start: i, end: i + 1 } });
      i++;
      continue;
    }
    if (c === '&' || c === '|')
      return fail('operator_doubled', `unexpected '${c}', did you mean '${c}${c}'?`, i, i + 1, { char: c });
    if (c === '=') return fail('assign_unsupported', "unexpected '=', did you mean '=='?", i, i + 1);
    return fail('character_unexpected', `unexpected character '${c}'`, i, i + 1, { char: c });
  }
  tokens.push({ kind: 'eof', text: '', value: null, span: { start: src.length, end: src.length } });
  return { ok: true, tokens };
}
