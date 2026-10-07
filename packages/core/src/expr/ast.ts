/**
 * The rule-language AST (docs/06-rule-language.md).
 * CONTRACT — written by the lead; changes need the lead. The parser (hand-written or a
 * CEL library) sits behind this shape, so it stays swappable (O2).
 * Every consumer (check, evaluate, toSql, explain, toChips, fromCql2) works on this union only.
 */
import type { ExprBinaryOperator, ExprLiteralKind, ExprMacro, ExprUnaryOperator } from '../registry';

/** Half-open UTF-16 offsets into the source string: [start, end). */
export interface Span {
  readonly start: number;
  readonly end: number;
}

interface NodeBase {
  readonly span: Span;
}

export interface LiteralNode extends NodeBase {
  readonly kind: 'literal';
  readonly type: ExprLiteralKind;
  readonly value: boolean | number | string | null;
}

/** A bare name: `self`, `form`, `actor`, `inputs`, `value`, `other`, `now` or a `bind` name. */
export interface IdentNode extends NodeBase {
  readonly kind: 'ident';
  readonly name: string;
}

/** `object.field` — property access and relation traversal. */
export interface MemberNode extends NodeBase {
  readonly kind: 'member';
  readonly object: Expr;
  readonly field: string;
}

/** `object[index]` — list index or map lookup. */
export interface IndexNode extends NodeBase {
  readonly kind: 'index';
  readonly object: Expr;
  readonly index: Expr;
}

/** `name(args)` or receiver style `target.name(args)` (e.g. `s.startsWith('a')`). */
export interface CallNode extends NodeBase {
  readonly kind: 'call';
  readonly name: string;
  readonly target?: Expr;
  readonly args: readonly Expr[];
}

/** `has(self.prop)` — presence test; `select` is the member being tested. */
export interface HasNode extends NodeBase {
  readonly kind: 'has';
  readonly select: MemberNode;
}

/** `range.exists(x, pred)` etc. `variable` is bound only inside `body`. */
export interface ComprehensionNode extends NodeBase {
  readonly kind: 'comprehension';
  readonly macro: ExprMacro;
  readonly range: Expr;
  readonly variable: string;
  readonly body: Expr;
}

export interface UnaryNode extends NodeBase {
  readonly kind: 'unary';
  readonly op: ExprUnaryOperator;
  readonly operand: Expr;
}

export interface BinaryNode extends NodeBase {
  readonly kind: 'binary';
  readonly op: ExprBinaryOperator;
  readonly left: Expr;
  readonly right: Expr;
}

export interface ConditionalNode extends NodeBase {
  readonly kind: 'conditional';
  readonly test: Expr;
  readonly then: Expr;
  readonly else: Expr;
}

export interface ListNode extends NodeBase {
  readonly kind: 'list';
  readonly elements: readonly Expr[];
}

export interface MapEntry {
  readonly key: Expr;
  readonly value: Expr;
  readonly span: Span;
}

export interface MapNode extends NodeBase {
  readonly kind: 'map';
  readonly entries: readonly MapEntry[];
}

export type Expr =
  | LiteralNode
  | IdentNode
  | MemberNode
  | IndexNode
  | CallNode
  | HasNode
  | ComprehensionNode
  | UnaryNode
  | BinaryNode
  | ConditionalNode
  | ListNode
  | MapNode;

export type ExprKind = Expr['kind'];

/** A parse error with a precise span and a human-readable message. */
export interface ParseError {
  readonly message: string;
  readonly span: Span;
}

/** Bounds that make the parser safe for untrusted input (H4, H6). */
export interface ParseLimits {
  /** Maximum source length in UTF-16 code units. */
  readonly maxLength: number;
  /** Maximum nesting depth (parentheses, brackets, calls, unary and `?:` chains). Flat operator chains such as `a || b || c` do not add depth. */
  readonly maxDepth: number;
}

/** Named limit sets: `config` for project files, `untrusted` for assistant output and CQL2 input. */
export const PARSE_LIMITS = {
  config: { maxLength: 32_768, maxDepth: 64 },
  untrusted: { maxLength: 16_384, maxDepth: 16 },
} as const satisfies Record<string, ParseLimits>;

export type ParseResult =
  { readonly ok: true; readonly ast: Expr } | { readonly ok: false; readonly errors: readonly ParseError[] };
