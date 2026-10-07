import { defineRegistry, type KeyOf } from './define';

// The descriptive tables behind the `matches` pattern errors. Only the builder words and tests read them, the parser
// needs just the key types: kept out of the participant chunk (WP-858). Root export `@ueberblick/core` and `registry/expr-errors`.

/** Why a pattern is not valid syntax (`matches_pattern_syntax`, param `detail`). */
export const MATCHES_SYNTAX_PROBLEMS = defineRegistry([
  { key: 'unclosed_group', description: '`(` without its `)`.' },
  { key: 'unmatched_paren', description: '`)` without its `(`.' },
  { key: 'unclosed_class', description: '`[` without its `]`.' },
  { key: 'empty_class', description: '`[]` has no characters.' },
  {
    key: 'bad_range',
    description: 'A class range whose end is before its start, or a shorthand as a range end.',
  },
  { key: 'bad_repeat', description: 'A `{m,n}` that is malformed or has `m` above `n`.' },
  { key: 'nothing_to_repeat', description: 'A quantifier with nothing before it.' },
  { key: 'bad_escape', description: 'A backslash followed by a character that has no meaning.' },
  { key: 'trailing_backslash', description: 'The pattern ends with a backslash.' },
  { key: 'nested_too_deep', description: 'Groups nested deeper than the limit.' },
] as const);
export type MatchesSyntaxProblem = KeyOf<typeof MATCHES_SYNTAX_PROBLEMS>;

/** Regular-expression features the subset leaves out on purpose (`matches_pattern_unsupported`, param `feature`). */
export const MATCHES_UNSUPPORTED_FEATURES = defineRegistry([
  { key: 'backreference', description: '`\\1`: a backreference cannot be matched in linear time.' },
  { key: 'lookaround', description: '`(?=`, `(?!`, `(?<=`, `(?<!`.' },
  { key: 'named_group', description: '`(?<name>` or `(?P<name>`.' },
  { key: 'group_flag', description: '`(?i)` and other inline flags.' },
  { key: 'lazy_quantifier', description: '`*?`, `+?`, `??`, `{m,n}?`.' },
  { key: 'possessive_quantifier', description: '`*+`, `++`, `?+`.' },
  { key: 'word_boundary', description: '`\\b` and `\\B`.' },
  { key: 'unicode_property', description: '`\\p{…}` and `\\P{…}`.' },
  { key: 'shorthand_in_class', description: '`\\D`, `\\W`, `\\S` inside `[...]`.' },
] as const);
export type MatchesUnsupportedFeature = KeyOf<typeof MATCHES_UNSUPPORTED_FEATURES>;
