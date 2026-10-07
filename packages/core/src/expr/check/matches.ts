/** `matches(text, pattern)`: the pattern must be a string literal and valid in the safe subset (docs/06, WP-428). */
import type { CallNode } from '../ast';
import { patternProblem } from '../pattern';
import type { Checker } from './check';

const describe = (params: Readonly<Record<string, string | number>>): string =>
  Object.entries(params)
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(', ');

export function checkMatchesPattern(h: Checker, e: CallNode): void {
  const arg = e.target ? e.args[0] : e.args[1];
  if (!arg) return;
  if (arg.kind !== 'literal' || arg.type !== 'string') {
    h.err('matches_pattern_literal', 'the pattern of matches() is a string in quotes', arg.span, {});
    return;
  }
  const problem = patternProblem(arg.value as string);
  if (!problem) return;
  h.err(problem.code, `invalid pattern for matches(): ${describe(problem.params)}`, arg.span, problem.params);
}
