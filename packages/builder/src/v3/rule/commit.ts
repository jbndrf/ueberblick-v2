/**
 * The action pane's one write path (an automatic action is an entry inside its task, so an edit compares `tasks`). As in
 * the task pane's `commitOps`, the ops
 * are tried first and an edit that would leave a new problem under one of `scopes` (key paths) is not applied;
 * the reason comes back for the pane to show in place. Applied through the frame's `apply` (`Doc.apply`).
 */
import type { Op } from '../../doc';
import { labelOf } from '../../shell/location';
import type { BuilderContext } from '../shell/context';
import { reasonText } from '../task/commit';
import { refusalText } from '../shell/refusal';

const key = (p: { code: string; path: string }): string => `${p.code} ${p.path}`;
const under = (path: string, scope: string): boolean =>
  path === scope || path.startsWith(`${scope}.`) || path.startsWith(`${scope}[`);

export function commitRuleOps(
  ctx: BuilderContext,
  ops: readonly Op[],
  scopes: readonly string[],
): string | undefined {
  if (ops.length === 0) return undefined;
  const doc = ctx.doc();
  const before = new Set(doc.problems().map(key));
  let cur = doc;
  let problems = doc.problems();
  for (const op of ops) {
    const r = cur.apply(op);
    if (r.refused !== undefined) return refusalText(ctx.t, ctx.doc(), [op], r.refused, ctx.locale);
    cur = r.doc;
    problems = r.problems;
  }
  const fresh = problems.find((p) => scopes.some((s) => under(p.path, s)) && !before.has(key(p)));
  if (fresh !== undefined) {
    return reasonText(ctx, {
      ok: false,
      reason: 'problem',
      message: labelOf(fresh.message, ctx.locale, fresh.code),
      ...(fresh.hint !== undefined ? { hint: fresh.hint } : {}),
    });
  }
  const shape = (d: typeof doc): string => JSON.stringify(d.effective().tasks);
  if (shape(cur) === shape(doc)) return undefined;
  for (const op of ops) {
    const r = ctx.apply(op);
    if (r.refused !== undefined) return refusalText(ctx.t, ctx.doc(), [op], r.refused, ctx.locale);
  }
  return undefined;
}
