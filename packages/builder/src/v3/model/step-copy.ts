/**
 * Moves or copies a task step between two task buttons (v3 `TaskCanvas.svelte:292-319`: drag a tool icon onto
 * another button; move by default, Alt copies). A tool icon is a step of the task (`steps`: Formular,
 * Schnellbearbeitung, Standort); a form step takes its fields along, because they stay in the task's keyed
 * `form`. v3 also had "copy by reference" (Ctrl): tools were shared entities there. In v4 a form and a quick
 * edit belong to one task, so only a copy of the step exists. Pure functions of the Doc (R1): the canvas drag,
 * its keyboard path and an assistant (H4) write the same ops.
 */
import { stepProperties, type TaskStep } from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { setOps } from '../../lenses/task/edit';
import { addStepOps, removeStepOps, stepList, subjectTypeOf } from '../task/step-ops';

export const STEP_COPY_REFUSALS = {
  /** There is no such step or task. */
  unknown: 'unknown',
  /** The same button: nothing to move. */
  same: 'same',
  /** The target already has a form (one form step per task). */
  hasForm: 'has_form',
  /** The target already writes one of the step's properties (one writer each), or does not have it. */
  property: 'property',
} as const;
export type StepCopyRefusal = (typeof STEP_COPY_REFUSALS)[keyof typeof STEP_COPY_REFUSALS];

export type StepCopyResult =
  | { readonly ok: true; readonly ops: readonly Op[] }
  | { readonly ok: false; readonly reason: StepCopyRefusal };

const propertiesOf = (step: TaskStep): readonly string[] =>
  step.kind === 'quick_edit' ? step.properties : step.kind === 'location' ? [step.property] : [];

/**
 * The ops that put step `index` of task `from` at the end of the steps of task `to`; with `copy` false it
 * leaves `from`. `fallback` is the builder's type (a task without `creates` or `on` types works on it).
 */
export function copyStepOps(
  doc: Doc,
  from: string,
  index: number,
  to: string,
  copy: boolean,
  fallback: string,
): StepCopyResult {
  const file = doc.effective();
  const step = stepList(file, from)[index];
  const source = file.tasks?.[from];
  const target = file.tasks?.[to];
  if (step === undefined || source === undefined || target === undefined) {
    return { ok: false, reason: STEP_COPY_REFUSALS.unknown };
  }
  if (from === to) return { ok: false, reason: STEP_COPY_REFUSALS.same };
  if (step.kind === 'form' && target.form !== undefined)
    return { ok: false, reason: STEP_COPY_REFUSALS.hasForm };
  const props = file.types?.[subjectTypeOf(file, to, fallback)]?.properties ?? {};
  const taken = new Set([...Object.keys(target.form ?? {}), ...stepProperties(target)]);
  if (propertiesOf(step).some((p) => props[p] === undefined || taken.has(p))) {
    return { ok: false, reason: STEP_COPY_REFUSALS.property };
  }
  const ops: Op[] = [];
  let cur = doc;
  const run = (made: readonly Op[]): void => {
    for (const op of made) {
      ops.push(op);
      cur = cur.apply(op).doc;
    }
  };
  run(addStepOps(cur, to, step));
  // The fields of the form are the task's `form`; `addStepOps` made it empty.
  if (step.kind === 'form' && source.form !== undefined)
    run(setOps(cur, `tasks.${to}.form`, structuredClone(source.form)));
  if (!copy) run(removeStepOps(cur, from, index));
  return { ok: true, ops };
}
