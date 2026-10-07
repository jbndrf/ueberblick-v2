/**
 * The one way the task pane writes (v3 wrote through its task store; here the file is the store): the
 * ops are tried with `planEdit` first, so an edit that would leave a new problem at the task is not
 * applied and the reason shows in place; then they go through the frame's `apply` (`Doc.apply`).
 */
import type { Op } from '../../doc';
import { planEdit, type EditFailure } from '../../lenses/task/edit';
import type { BuilderContext } from '../shell/context';
import { refusalText } from '../shell/refusal';

export function reasonText(ctx: BuilderContext, f: EditFailure, ops: readonly Op[] = []): string {
  if (f.reason === 'no_effect') return ctx.t('task_no_effect');
  if (f.reason === 'refused') return refusalText(ctx.t, ctx.doc(), ops, f.refusal, ctx.locale);
  return ctx.t('task_not_applied', {
    message: f.hint ? `${f.message} ${f.hint}` : f.message,
  });
}

/** Applies `ops` (checked against the problems at `scope`, a key path); returns why not. */
export function commitOps(ctx: BuilderContext, ops: readonly Op[], scope: string): string | undefined {
  if (ops.length === 0) return undefined;
  const plan = planEdit(ctx.doc(), ops, scope, ctx.locale);
  if (!plan.ok) return plan.reason === 'no_effect' ? undefined : reasonText(ctx, plan, ops);
  const r = ctx.applyBatch(ops);
  return 'refused' in r ? refusalText(ctx.t, ctx.doc(), ops, r.refused, ctx.locale) : undefined;
}
