/**
 * Reports what the parser and the checker found in one expression, with the params the builder words them from.
 * `params.expr_code` is the error's registry code (`EXPR_ERRORS`), the error's own params follow; no English
 * detail goes into the params, the builder words the detail from code and params in the admin's language (WP-421).
 */
import type { CodedParseError } from '../../expr/parse/errors';
import type { CheckError } from '../../expr/check/types';
import type { ProblemParams } from './contract';
import type { Sink } from './problems';

/** The params of an `expression_parse` problem. */
export function parseProblemParams(source: string, e: CodedParseError): ProblemParams {
  return { ...e.params, expr_code: e.code, source, position: e.span.start };
}

/** The params of an `expression_type` problem. */
export function typeProblemParams(source: string, e: CheckError): ProblemParams {
  return { ...e.params, expr_code: e.code, source };
}

/** The English hint of an `expression_parse` problem. */
export const parseProblemHint = (source: string, e: CodedParseError): string =>
  `fix the syntax of \`${source}\` at offset ${e.span.start}; expressions follow the rule language (docs/06)`;

/** One `expression_parse` problem per parse error of `source`. */
export function reportParseErrors(
  sink: Sink,
  path: string,
  source: string,
  errors: readonly CodedParseError[],
): void {
  for (const e of errors) {
    sink.error(
      path,
      'expression_parse',
      e.message,
      parseProblemHint(source, e),
      parseProblemParams(source, e),
      e.span,
    );
  }
}

/** One `expression_type` problem per checker error; `fallbackHint` is used when the checker gave none. */
export function reportTypeErrors(
  sink: Sink,
  path: string,
  source: string,
  errors: readonly CheckError[],
  fallbackHint: string,
): void {
  for (const e of errors) {
    sink.error(
      path,
      'expression_type',
      e.message,
      e.hint ?? fallbackHint,
      typeProblemParams(source, e),
      e.span,
    );
  }
}
