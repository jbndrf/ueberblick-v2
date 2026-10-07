import { defineRegistry, type KeyOf } from './define';

/** Static types of the rule language (docs/06-rule-language.md). */
export const EXPR_TYPE_KINDS = defineRegistry([
  { key: 'bool', description: 'true or false.' },
  { key: 'int', description: 'Whole number.' },
  { key: 'double', description: 'Floating-point number.' },
  { key: 'string', description: 'Text.' },
  { key: 'null', description: 'The type of the null literal; compatible with every type in comparisons.' },
  {
    key: 'dyn',
    description: 'Unknown at check time; compatible with everything (untyped JSON, map values).',
  },
  { key: 'geometry', description: 'A GeoJSON geometry.' },
  { key: 'timestamp', description: 'An instant (dates and date-times).' },
  { key: 'duration', description: 'A length of time.' },
  { key: 'list', description: 'A list with one element type (also relation sets).' },
  { key: 'map', description: 'A map with key and value types.' },
  { key: 'record', description: 'A fixed set of named fields (actor, inputs, form).' },
  { key: 'feature', description: 'A feature of a declared feature type; fields come from the environment.' },
] as const);
export type ExprTypeKind = KeyOf<typeof EXPR_TYPE_KINDS>;

/** Token kinds of the rule-language lexer. */
export const TOKEN_KINDS = defineRegistry([
  { key: 'int', description: 'Integer literal.' },
  { key: 'double', description: 'Floating-point literal.' },
  { key: 'string', description: 'String literal.' },
  { key: 'ident', description: 'Name or keyword.' },
  { key: 'punct', description: 'Operator or bracket.' },
  { key: 'eof', description: 'End of input.' },
] as const);
export type TokenKind = KeyOf<typeof TOKEN_KINDS>;
