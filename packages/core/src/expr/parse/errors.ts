/**
 * Errors of the rule-language parser. `ParseError` (ast.ts) is the shape every reader of the AST returns; the
 * parser always sets `code` and `params` too (registry `EXPR_ERRORS`), so a consumer can word the error in another
 * language. The English `message` stays for logs and assistants. The CQL2 reader sets no code.
 */
import type { ExprErrorCode, ExprErrorParams } from '../../registry/expr-errors';
import type { Expr, ParseError } from '../ast';

export type { ExprErrorParams };

/** A parse error of the rule-language parser: code and params are always there. */
export type CodedParseError = ParseError & {
  readonly code: ExprErrorCode;
  readonly params: ExprErrorParams;
};

/** What `parse` returns: like `ParseResult`, with coded errors. */
export type CodedParseResult =
  | { readonly ok: true; readonly ast: Expr }
  | { readonly ok: false; readonly errors: readonly CodedParseError[] };
