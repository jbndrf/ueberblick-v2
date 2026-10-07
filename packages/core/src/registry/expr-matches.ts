/**
 * Limits of the `matches(text, pattern)` pattern language (docs/06-rule-language.md, WP-428). A pattern is untrusted
 * configuration (and assistant input, H4), so its size, nesting and compiled size are bounded; the matcher itself
 * is linear in the text (a Thompson NFA, no backtracking).
 */
export const MATCHES_LIMITS = {
  /** Longest pattern, in characters. */
  patternLength: 200,
  /** Largest `{m,n}` bound. */
  repeatMax: 50,
  /** Deepest group nesting. */
  groupDepth: 8,
  /** Most NFA states a pattern may compile to (bounded repeats are expanded). */
  states: 1000,
  /**
   * Cache caps of the matcher (memory, not behaviour: a full cache stops remembering and computes, so results and
   * the linear bound do not change). One DFA state is at most about 5 KB (a 128-slot table and its NFA set), a
   * program's ASCII table at most 128 KB, a remembered non-ASCII transition about 50 bytes, so one program stays
   * under 1 MB and the whole cache (`programs`) under about 32 MB.
   */
  dfaStates: 128,
  /** Remembered transitions per program, ASCII and non-ASCII together. */
  dfaTransitions: 4096,
  /** Compiled patterns kept; the cache is emptied when full. */
  programs: 32,
} as const;
