/**
 * Limits on what an assistant may send (H4): its input is untrusted. Sizes are capped before any op is
 * applied, and every expression an op brings into the file must parse under core's untrusted limits.
 */
import type { CompiledConfig } from '@ueberblick/core';
import { PARSE_LIMITS, parse } from '@ueberblick/core/expr/compile';
import type { Op } from '../doc';

export const MAX_OPS = 50;
export const MAX_OPS_BYTES = 200_000;
export const MAX_VALUE_DEPTH = 32;
export const MAX_PATH_LENGTH = 512;
/** Strings of an op value are capped at the untrusted expression length (labels are far shorter). */
export const MAX_STRING_LENGTH: number = PARSE_LIMITS.untrusted.maxLength;

/** Nesting depth of a JSON value, counted by a loop (an assistant value can be deeper than the stack). */
function depthOf(value: unknown, cap: number): number {
  let deepest = 0;
  const stack: [unknown, number][] = [[value, 1]];
  while (stack.length > 0) {
    const [v, d] = stack.pop() as [unknown, number];
    if (d > deepest) deepest = d;
    if (deepest > cap) return deepest;
    if (typeof v === 'object' && v !== null) for (const child of Object.values(v)) stack.push([child, d + 1]);
  }
  return deepest;
}

function longestString(value: unknown): number {
  let longest = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === 'string') longest = Math.max(longest, v.length);
    else if (typeof v === 'object' && v !== null) stack.push(...Object.values(v));
  }
  return longest;
}

/** A reason the ops are too large, or undefined. */
export function opsTooLarge(ops: readonly Op[]): string | undefined {
  if (ops.length > MAX_OPS) return `Send at most ${MAX_OPS} ops at a time.`;
  if (JSON.stringify(ops).length > MAX_OPS_BYTES)
    return `The ops are larger than ${MAX_OPS_BYTES} characters.`;
  for (const [i, op] of ops.entries()) {
    if (op.path.length > MAX_PATH_LENGTH)
      return `op ${i}: the path is longer than ${MAX_PATH_LENGTH} characters.`;
    if (!('value' in op)) continue;
    if (depthOf(op.value, MAX_VALUE_DEPTH) > MAX_VALUE_DEPTH)
      return `op ${i}: the value is nested deeper than ${MAX_VALUE_DEPTH} levels.`;
    if (longestString(op.value) > MAX_STRING_LENGTH)
      return `op ${i}: a text in the value is longer than ${MAX_STRING_LENGTH} characters.`;
  }
  return undefined;
}

export interface ExpressionProblem {
  readonly path: string;
  readonly message: string;
}

/**
 * Expressions the ops brought in (at or below the path of an op that carries a value) that do not parse
 * under the untrusted limits. It reads the compiled expressions, so it names exactly the ones the file
 * holds. A file that does not compile has none to read: its problems are reported, and the config
 * limits (`PARSE_LIMITS.config`) still bound every expression.
 */
export function untrustedExpressionProblems(
  ops: readonly Op[],
  config: CompiledConfig | undefined,
): readonly ExpressionProblem[] {
  if (config === undefined) return [];
  const out: ExpressionProblem[] = [];
  for (const [path, e] of config.expressions) {
    if (!ops.some((op) => 'value' in op && (path === op.path || path.startsWith(`${op.path}.`)))) continue;
    const r = parse(e.source, PARSE_LIMITS.untrusted);
    if (!r.ok)
      out.push({
        path,
        message: `An expression from an assistant must stay within ${PARSE_LIMITS.untrusted.maxLength} characters and ${PARSE_LIMITS.untrusted.maxDepth} levels: ${r.errors[0]?.message ?? 'it does not parse'}`,
      });
  }
  return out;
}
