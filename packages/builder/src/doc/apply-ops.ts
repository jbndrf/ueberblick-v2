/**
 * The all-or-none fold of a batch of ops (docs/08-builder.md "Code view"). A Doc is immutable: the
 * ops are folded over `apply` and only the last Doc is adopted, so a refusal at any step stops the
 * fold and the original Doc is left exactly as it was. `applyEntityYaml` pre-checks its ops the same
 * way (a trial fold), so a refusal here is not expected.
 */
import type { ApplyOpsResult, Doc, Op } from './contract';

export function applyOps(doc: Doc, ops: readonly Op[]): ApplyOpsResult {
  let cur = doc;
  let problems = cur.problems();
  for (const op of ops) {
    const r = cur.apply(op);
    if (r.refused) return { refused: r.refused };
    cur = r.doc;
    problems = r.problems;
  }
  return { doc: cur, problems };
}
