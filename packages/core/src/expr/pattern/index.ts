/** The `matches` pattern engine (docs/06 "matches", WP-428): parse, compile to a Thompson NFA, run in linear time. */
import { patternProgram, runProgram } from './nfa';
import type { PatternProblem } from './parse';

export { cacheStats, compilePattern, patternProgram, runProgram, type Program } from './nfa';
export { parsePattern, type PatternNode, type PatternProblem } from './parse';

/** `text` contains a match of `pattern`; `undefined` when the pattern is not valid (check refuses those). */
export function matchesPattern(text: string, pattern: string): boolean | undefined {
  const p = patternProgram(pattern);
  return p.ok ? runProgram(p.program, text) : undefined;
}

/** The compile problem of `pattern`, or `undefined` when it is valid. */
export function patternProblem(pattern: string): PatternProblem | undefined {
  const p = patternProgram(pattern);
  return p.ok ? undefined : p.problem;
}
