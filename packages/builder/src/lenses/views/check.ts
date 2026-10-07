/**
 * The live check of a typed filter: the op is tried with `Doc.apply`, which compiles the effective
 * file with core's type checker, and the problems at the filter's own path are what the admin sees
 * before applying (R5: the one rule language, checked by core, not by the lens).
 */
import type { Problem } from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { labelOf } from '../../shell/location';

export interface PathProblem {
  readonly message: string;
  readonly hint?: string;
}

/** Problems of the checked file at `path` (or below it), in the reader's language. */
export function problemsAt(
  problems: readonly Problem[],
  path: string,
  locale: string,
): readonly PathProblem[] {
  return problems
    .filter((p) => p.path === path || p.path.startsWith(`${path}.`))
    .map((p) => ({
      message: labelOf(p.message, locale, p.code),
      ...(p.hint !== undefined ? { hint: p.hint } : {}),
    }));
}

export type OpCheck =
  | { readonly ok: true; /** True when the op would change nothing. */ readonly unchanged: boolean }
  | { readonly ok: false; readonly message: string; readonly hint?: string };

/** Tries `op` on `doc` without keeping it; `path` is where a type error of the op would be reported. */
export function checkOp(doc: Doc, op: Op, path: string, locale: string): OpCheck {
  const r = doc.apply(op);
  if (r.refused !== undefined) return { ok: false, message: r.refused.message };
  const first = problemsAt(r.problems, path, locale)[0];
  if (first !== undefined)
    return { ok: false, message: first.message, ...(first.hint ? { hint: first.hint } : {}) };
  return { ok: true, unchanged: r.doc === doc };
}
