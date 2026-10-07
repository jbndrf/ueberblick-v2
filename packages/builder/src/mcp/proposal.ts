/**
 * Ops on the draft in memory: the one place `propose`, `simulate`, `apply` and the human confirmation
 * turn a list of ops into a resulting document. It is `Doc.apply` (R3): no second way to edit, and
 * nothing is stored here.
 */
import { compile, NO_ASSETS } from '@ueberblick/core';
import { DocOpenError, openProject, type Doc, type Op } from '../doc';
import type { DraftRead } from './contract';
import { opsTooLarge, untrustedExpressionProblems } from './limits';

export interface Refusal {
  readonly code: string;
  readonly message: string;
  /** The op that was refused, when one was. */
  readonly index?: number;
  readonly path?: string;
  readonly issues?: readonly string[];
}

export type Applied =
  | { readonly ok: true; readonly before: Doc; readonly after: Doc }
  | { readonly ok: false; readonly refusal: Refusal };

/** Opens the draft and applies `ops` in order; the first refusal stops it (nothing is partly applied). */
export function applyOps(draft: DraftRead, ops: readonly Op[]): Applied {
  const tooLarge = opsTooLarge(ops);
  if (tooLarge !== undefined) return { ok: false, refusal: { code: 'too_large', message: tooLarge } };
  let before: Doc;
  try {
    before = openProject(draft.templateSrc, draft.overlaySrc);
  } catch (e) {
    if (e instanceof DocOpenError)
      return { ok: false, refusal: { code: 'not_openable', message: e.message, issues: e.issues } };
    throw e;
  }
  let after = before;
  for (const [index, op] of ops.entries()) {
    const r = after.apply(op);
    if (r.refused !== undefined)
      return {
        ok: false,
        refusal: { code: 'op_refused', message: r.refused.message, index, path: r.refused.path },
      };
    after = r.doc;
  }
  const compiled = compile(after.effective(), { assets: NO_ASSETS });
  const bad = untrustedExpressionProblems(ops, compiled.ok ? compiled.config : undefined);
  if (bad.length > 0)
    return {
      ok: false,
      refusal: {
        code: 'expression_limits',
        message: bad[0]?.message ?? 'An expression is beyond the limits.',
        ...(bad[0] === undefined ? {} : { path: bad[0].path }),
        issues: bad.map((p) => `${p.path}: ${p.message}`),
      },
    };
  return { ok: true, before, after };
}
