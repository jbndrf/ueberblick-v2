/**
 * The one way the form editor writes (the task pane's `commitOps`, for edits that reach beyond the task): the ops
 * are tried with `planEdit` first, so an edit that would leave a new problem at the task (a field no role may
 * write, say) is not applied and the reason shows in place; then they go through the frame's `apply`. A width or a
 * label is written on the property, not under `tasks`, so "no effect" is judged on the whole file here.
 */
import type { Doc, Op } from '../../doc';
import { planEdit } from '../../lenses/task/edit';
import type { BuilderContext } from '../shell/context';
import { reasonText } from '../task/commit';
import { refusalText } from '../shell/refusal';

const changes = (doc: Doc, ops: readonly Op[]): boolean => {
  const r = doc.applyBatch(ops);
  return 'doc' in r && JSON.stringify(r.doc.effective()) !== JSON.stringify(doc.effective());
};

/** Applies `ops` (checked against the problems at `scope`, a key path); returns why not. */
export function commitForm(ctx: BuilderContext, ops: readonly Op[], scope: string): string | undefined {
  if (ops.length === 0) return undefined;
  const plan = planEdit(ctx.doc(), ops, scope, ctx.locale);
  if (!plan.ok) {
    if (plan.reason !== 'no_effect') return reasonText(ctx, plan, ops);
    if (!changes(ctx.doc(), ops)) return undefined;
  }
  const r = ctx.applyBatch(ops);
  return 'refused' in r ? refusalText(ctx.t, ctx.doc(), ops, r.refused, ctx.locale) : undefined;
}
