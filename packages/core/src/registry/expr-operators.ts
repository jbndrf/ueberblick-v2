import { defineRegistry, type KeyOf } from './define';

/** Unary operators of the rule language (docs/06-rule-language.md). */
export const EXPR_UNARY_OPERATORS = defineRegistry([
  { key: '!', description: 'Logical not.' },
  { key: '-', description: 'Numeric negation.' },
] as const);
export type ExprUnaryOperator = KeyOf<typeof EXPR_UNARY_OPERATORS>;

/** Binary operators of the rule language (docs/06-rule-language.md). */
export const EXPR_BINARY_OPERATORS = defineRegistry([
  { key: '&&', description: 'Logical and (CEL commutative error semantics).' },
  { key: '||', description: 'Logical or (CEL commutative error semantics).' },
  { key: '==', description: 'Equality.' },
  { key: '!=', description: 'Inequality.' },
  { key: '<', description: 'Less than.' },
  { key: '<=', description: 'Less than or equal.' },
  { key: '>', description: 'Greater than.' },
  { key: '>=', description: 'Greater than or equal.' },
  { key: '+', description: 'Addition, string and list concatenation.' },
  { key: '-', description: 'Subtraction.' },
  { key: '*', description: 'Multiplication.' },
  { key: '/', description: 'Division.' },
  { key: '%', description: 'Remainder.' },
  { key: 'in', description: 'Membership in a list or map keys.' },
] as const);
export type ExprBinaryOperator = KeyOf<typeof EXPR_BINARY_OPERATORS>;

/** Comprehension macros over lists and relation sets. `has()` is its own AST node. */
export const EXPR_MACROS = defineRegistry([
  { key: 'exists', description: 'True if the predicate holds for at least one element.' },
  { key: 'all', description: 'True if the predicate holds for every element.' },
  { key: 'filter', description: 'The elements for which the predicate holds.' },
  { key: 'map', description: 'The transformed elements.' },
] as const);
export type ExprMacro = KeyOf<typeof EXPR_MACROS>;

/** Literal kinds of the rule language. */
export const EXPR_LITERAL_KINDS = defineRegistry([
  { key: 'bool', description: 'true or false.' },
  { key: 'int', description: 'A 64-bit signed integer (held as a JS number within the safe range).' },
  { key: 'double', description: 'An IEEE-754 double.' },
  { key: 'string', description: 'A Unicode string.' },
  { key: 'null', description: 'The null value.' },
] as const);
export type ExprLiteralKind = KeyOf<typeof EXPR_LITERAL_KINDS>;
