import { defineRegistry, type KeyOf } from './define';

/**
 * Parse and type errors of the rule language (docs/06-rule-language.md, WP-421). Every error the parser or the
 * checker reports carries one of these codes and flat `params`; the English `message` and `hint` stay for logs and
 * assistants, the builder words the error in the admin's language from code and params. `params` lists the names
 * the error carries; `hints` lists the hint variants (`default` is the only one when the hint has no variant).
 * Type names in params are the names of docs/06 (`bool`, `list<string>`, `feature baum`).
 */
export const EXPR_ERRORS = defineRegistry([
  // Lexer
  { key: 'hex_digits_missing', description: '`0x` without digits.', params: [], hints: [] },
  { key: 'unsigned_unsupported', description: 'A `u` suffix on an integer.', params: [], hints: [] },
  {
    key: 'int_out_of_range',
    description: 'An integer literal beyond the safe range.',
    params: [],
    hints: [],
  },
  {
    key: 'number_runs_into_name',
    description: 'A number directly followed by a name.',
    params: [],
    hints: [],
  },
  { key: 'number_out_of_range', description: 'A number literal beyond the range.', params: [], hints: [] },
  { key: 'triple_quote_unsupported', description: 'A triple-quoted string.', params: [], hints: [] },
  { key: 'string_newline', description: 'A line break inside a string.', params: [], hints: [] },
  {
    key: 'escape_hex_invalid',
    description: 'An escape with too few hex digits.',
    params: ['escape', 'digits'],
    hints: [],
  },
  {
    key: 'escape_code_point_invalid',
    description: 'An escape that is not a code point.',
    params: [],
    hints: [],
  },
  { key: 'escape_unknown', description: 'An unknown escape sequence.', params: ['escape'], hints: [] },
  { key: 'string_unterminated', description: 'A string without its closing quote.', params: [], hints: [] },
  { key: 'raw_bytes_unsupported', description: 'A raw or bytes literal.', params: [], hints: [] },
  { key: 'operator_doubled', description: '`&` or `|` alone.', params: ['char'], hints: [] },
  { key: 'assign_unsupported', description: '`=` alone.', params: [], hints: [] },
  {
    key: 'character_unexpected',
    description: 'A character the language does not use.',
    params: ['char'],
    hints: [],
  },
  // Parser
  {
    key: 'expected_punct',
    description: 'A bracket or colon is missing.',
    params: ['expected', 'found_kind', 'found'],
    hints: [],
  },
  {
    key: 'expected_field_name',
    description: 'A name is missing after `.`.',
    params: ['found_kind', 'found'],
    hints: [],
  },
  { key: 'reserved_word', description: 'A reserved word used as a name.', params: ['name'], hints: [] },
  { key: 'keyword_as_name', description: 'A keyword used as a name.', params: ['name'], hints: [] },
  { key: 'struct_unsupported', description: 'A message or struct literal.', params: [], hints: [] },
  {
    key: 'unexpected_token',
    description: 'A token that cannot continue the expression.',
    params: ['found_kind', 'found'],
    hints: [],
  },
  { key: 'unexpected_end', description: 'The expression ends too early.', params: [], hints: [] },
  { key: 'nested_too_deep', description: 'Nesting beyond the parse limit.', params: ['max'], hints: [] },
  { key: 'too_long', description: 'Source longer than the parse limit.', params: ['max'], hints: [] },
  {
    key: 'macro_arguments',
    description: 'A macro without a variable and an expression.',
    params: ['macro'],
    hints: [],
  },
  { key: 'has_arguments', description: '`has()` without one field selection.', params: [], hints: [] },
  { key: 'parser_internal', description: 'An internal parser error.', params: [], hints: [] },
  // Checker
  {
    key: 'minus_operand',
    description: 'Unary `-` on a type that is no number.',
    params: ['actual'],
    hints: [],
  },
  {
    key: 'branch_types_differ',
    description: 'The two branches of `?:` differ.',
    params: ['left', 'right'],
    hints: [],
  },
  {
    key: 'map_key_type',
    description: 'A map key that is no string, int or bool.',
    params: ['actual'],
    hints: [],
  },
  { key: 'not_operand', description: '`!` needs bool.', params: ['expected', 'actual'], hints: [] },
  {
    key: 'condition_type',
    description: 'The condition of `?:` needs bool.',
    params: ['expected', 'actual'],
    hints: [],
  },
  {
    key: 'list_index_type',
    description: 'A list index needs int.',
    params: ['expected', 'actual'],
    hints: [],
  },
  {
    key: 'map_lookup_type',
    description: 'A map lookup key of the wrong type.',
    params: ['expected', 'actual'],
    hints: [],
  },
  {
    key: 'predicate_type',
    description: 'The predicate of a macro needs bool.',
    params: ['macro', 'expected', 'actual'],
    hints: [],
  },
  {
    key: 'count_type',
    description: 'The count of a history function needs int.',
    params: ['expected', 'actual'],
    hints: [],
  },
  {
    key: 'unknown_name',
    description: 'A name that is not in scope.',
    params: ['name', 'near', 'known'],
    hints: ['near', 'known', 'none'],
  },
  {
    key: 'unknown_feature_type',
    description: 'A feature type the environment lacks.',
    params: ['type'],
    hints: [],
  },
  {
    key: 'field_not_in_sql',
    description: 'A system field that has no column, in an SQL context.',
    params: ['field'],
    hints: ['default'],
  },
  {
    key: 'no_role_property',
    description: '`role` on a participant (it has `roles`).',
    params: [],
    hints: ['default'],
  },
  {
    key: 'no_property_on_type',
    description: 'A property the feature type lacks.',
    params: ['field', 'type', 'near', 'available'],
    hints: ['near', 'available', 'none'],
  },
  {
    key: 'no_property_on_record',
    description: 'A field the record lacks.',
    params: ['field', 'near', 'available'],
    hints: ['near', 'available', 'none'],
  },
  { key: 'list_field', description: 'A field read on a list.', params: ['field'], hints: ['default'] },
  {
    key: 'cannot_read_field',
    description: 'A field read on a type that has none.',
    params: ['field', 'actual'],
    hints: [],
  },
  {
    key: 'record_index',
    description: 'A record indexed by something other than a string literal.',
    params: [],
    hints: ['default'],
  },
  { key: 'cannot_index', description: 'An index on a type that has none.', params: ['actual'], hints: [] },
  {
    key: 'has_operand',
    description: '`has()` on something other than a record or map.',
    params: ['actual'],
    hints: [],
  },
  {
    key: 'macro_range',
    description: 'A macro over something other than a list.',
    params: ['macro', 'actual'],
    hints: [],
  },
  {
    key: 'op_needs_bool',
    description: '`&&` or `||` with non-bool operands.',
    params: ['op', 'left', 'right'],
    hints: [],
  },
  {
    key: 'op_compares_different',
    description: '`==` or `!=` on different types.',
    params: ['op', 'left', 'right'],
    hints: [],
  },
  {
    key: 'op_cannot_order',
    description: 'An ordering on types that have none.',
    params: ['op', 'left', 'right'],
    hints: [],
  },
  {
    key: 'op_in_mismatch',
    description: '`in` with an element and a collection that do not fit.',
    params: ['op', 'left', 'right'],
    hints: [],
  },
  {
    key: 'op_unsupported',
    description: 'An operator the language does not have.',
    params: ['op', 'left', 'right'],
    hints: [],
  },
  {
    key: 'op_needs_int',
    description: '`%` with non-int operands.',
    params: ['op', 'left', 'right'],
    hints: [],
  },
  {
    key: 'op_lists_differ',
    description: '`+` on lists of different element types.',
    params: ['op', 'left', 'right'],
    hints: [],
  },
  {
    key: 'op_not_applicable',
    description: 'An arithmetic operator that does not apply to these types.',
    params: ['op', 'left', 'right'],
    hints: [],
  },
  {
    key: 'unknown_function',
    description: 'A function the language does not have.',
    params: ['name', 'near'],
    hints: ['default'],
  },
  {
    key: 'no_signature',
    description: 'A call whose argument types match no signature.',
    params: ['call', 'expected'],
    hints: ['default'],
  },
  {
    key: 'history_arity',
    description: 'A history function with the wrong number of arguments.',
    params: ['name', 'count'],
    hints: [],
  },
  {
    key: 'history_needs_self',
    description: 'A history function without `self` in scope.',
    params: ['name'],
    hints: [],
  },
  {
    key: 'history_property_literal',
    description: 'A history function whose first argument is no quoted name.',
    params: ['name'],
    hints: ['default'],
  },
  {
    key: 'unknown_property',
    description: 'A history function names a property the subject lacks.',
    params: ['property', 'type', 'near', 'available'],
    hints: ['near', 'available_on_type', 'available_on_self', 'none'],
  },
  { key: 'count_minimum', description: 'A history count below 1.', params: [], hints: [] },
  {
    key: 'device_history_limit',
    description: 'A history count above the device limit.',
    params: ['limit'],
    hints: ['default'],
  },
  {
    key: 'device_count_literal',
    description: 'A history count that is no literal, on the device.',
    params: [],
    hints: [],
  },
  {
    key: 'result_type',
    description: 'The expression has another result type than its context needs.',
    params: ['expected', 'actual'],
    hints: [],
  },
  {
    key: 'matches_pattern_literal',
    description: 'The pattern of `matches` is no string literal.',
    params: [],
    hints: [],
  },
  {
    key: 'matches_pattern_too_long',
    description: 'The pattern of `matches` is longer than the limit.',
    params: ['max'],
    hints: [],
  },
  {
    key: 'matches_pattern_syntax',
    description:
      'The pattern of `matches` is no valid pattern (`detail`: MATCHES_SYNTAX_PROBLEMS, `at`: index).',
    params: ['detail', 'at'],
    hints: [],
  },
  {
    key: 'matches_pattern_unsupported',
    description:
      'The pattern uses a feature the subset leaves out (`feature`: MATCHES_UNSUPPORTED_FEATURES).',
    params: ['feature', 'at'],
    hints: [],
  },
  {
    key: 'matches_pattern_too_big',
    description: 'A `{m,n}` bound or the compiled pattern is larger than the limit (repeats are expanded).',
    params: ['max'],
    hints: [],
  },
] as const);
export type ExprErrorCode = KeyOf<typeof EXPR_ERRORS>;

/** The values an expression error is made of: flat, strings and numbers only (`EXPR_ERRORS` names them). */
export type ExprErrorParams = Readonly<Record<string, string | number>>;

/** What the parser found where it wanted something else (`params.found_kind`); `token` carries its text in `params.found`. */
export const EXPR_FOUND_KINDS = defineRegistry([
  { key: 'end', description: 'The end of the expression.' },
  { key: 'string', description: 'A string literal.' },
  { key: 'number', description: 'A number literal.' },
  { key: 'token', description: 'A name or an operator; `params.found` is its text.' },
] as const);
export type ExprFoundKind = KeyOf<typeof EXPR_FOUND_KINDS>;
export { MATCHES_SYNTAX_PROBLEMS, MATCHES_UNSUPPORTED_FEATURES } from './expr-matches-problems';
