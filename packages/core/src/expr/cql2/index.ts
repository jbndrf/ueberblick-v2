/**
 * `fromCql2`: an OGC API Features CQL2 filter (text or JSON encoding, Basic + Basic Spatial)
 * as an AST of `expr/ast.ts`, so external GIS filters use the same pipeline (check -> toSql).
 * Pure and total: it never throws and does no I/O. See docs/06-rule-language.md "CQL2".
 */
import { PARSE_LIMITS, type Expr, type ParseError, type ParseLimits, type ParseResult } from '../ast';
import { Cql2Failure } from './build';
import { fromJson } from './json';
import { fromText } from './text';

export interface Cql2Options {
  /** Size and depth bounds for untrusted input. Default: `PARSE_LIMITS.untrusted`. */
  readonly limits?: ParseLimits;
}

/**
 * `input` is CQL2 text, CQL2 JSON text (a string starting with `{`), or an already parsed
 * JSON value. Returns `{ ok: true, ast }` or `{ ok: false, errors }` like `parse` (each with a span; the first error stops
 * the read). Property references become `self.<prop>`.
 */
export function fromCql2(input: string | object | boolean, options: Cql2Options = {}): ParseResult {
  const limits = options.limits ?? PARSE_LIMITS.untrusted;
  try {
    let ast: Expr;
    let end = 0;
    if (typeof input === 'string') {
      end = input.length;
      if (input.length > limits.maxLength) {
        return fails({
          message: `filter is longer than ${String(limits.maxLength)} characters`,
          span: { start: limits.maxLength, end },
        });
      }
      if (input.trimStart().startsWith('{')) {
        ast = fromJson(parseJson(input), { start: 0, end }, limits.maxDepth, limits.maxLength);
      } else ast = fromText(input, limits.maxDepth);
    } else ast = fromJson(input, { start: 0, end }, limits.maxDepth, limits.maxLength);
    return { ok: true, ast };
  } catch (e) {
    if (e instanceof Cql2Failure) return fails(e.error);
    return fails({ message: 'filter could not be read', span: { start: 0, end: 0 } });
  }
}

const fails = (e: ParseError): ParseResult => ({ ok: false, errors: [e] });

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'invalid JSON';
    throw new Cql2Failure({
      message: `filter is not valid JSON: ${message}`,
      span: { start: 0, end: text.length },
    });
  }
}
