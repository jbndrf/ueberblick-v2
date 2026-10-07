/**
 * The Formular tab's edits (v3 "Werkzeuge", `TaskConfigSidebar.svelte:377-420`): the ordered `steps` of a
 * task as Doc ops, pure like `ops.ts` (R1). `steps` is the list in the file (`stepsOf`, `TASK_STEP_KINDS`);
 * the form's fields stay in the task's keyed `form`, so adding or removing the `form` step also adds or
 * removes `form` (schema: `form` and the form step go together; one form step at most).
 */
import { stepsOf, stepProperties, type TaskStep, type TemplateFile } from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { clearOps, setOps } from '../../lenses/task/edit';
import { onView } from '../../lenses/task/model';
import { labelOf } from '../../shell/location';
import { stagePropertyOf } from './ops';

const at = (task: string): string => `tasks.${task}`;

/** The steps a task runs, in order (its `steps`, else just its form). */
export function stepList(file: TemplateFile, task: string): readonly TaskStep[] {
  const t = file.tasks?.[task];
  return t === undefined ? [] : stepsOf(t);
}

/**
 * The granular overlay ops that make `next` the task's steps; `form` follows the form step. The file
 * schema refuses `form` without its form step and the other way round, so these ops are valid only
 * together: the caller applies them as one batch (`Doc.applyBatch`, the schema checked on the end state;
 * `commitOps`, `planEdit`). Nothing but `steps` and `form` is written, so the rest of a template task
 * keeps its provenance. A list of only the form is stored as no `steps`.
 */
export function stepsOps(doc: Doc, task: string, next: readonly TaskStep[]): readonly Op[] {
  const t = doc.effective().tasks?.[task];
  if (t === undefined) return [];
  const wantsForm = next.some((s) => s.kind === 'form');
  const keepsSteps = next.length > 0 && !(next.length === 1 && wantsForm);
  const steps = `${at(task)}.steps`;
  const form = `${at(task)}.form`;
  return [
    ...(keepsSteps ? setOps(doc, steps, next) : t.steps !== undefined ? clearOps(doc, steps) : []),
    ...(wantsForm && t.form === undefined ? setOps(doc, form, {}) : []),
    ...(!wantsForm && t.form !== undefined ? clearOps(doc, form) : []),
  ];
}

/** The feature type the steps edit: what the task creates, else its first `on` type, else `fallback`. */
export function subjectTypeOf(file: TemplateFile, task: string, fallback: string): string {
  const t = file.tasks?.[task];
  const on = t === undefined ? undefined : onView(t.on);
  return t?.creates ?? (on?.kind === 'types' ? on.types[0] : undefined) ?? fallback;
}

export interface StepCandidate {
  readonly key: string;
  readonly label: string;
}

/**
 * The properties a new step may take: of the subject type, not written by the form or another step (one
 * writer each), not the stage property (only `then.set` writes it). Quick edit takes everything but
 * geometries; Standort takes only geometries.
 */
export function stepCandidates(
  file: TemplateFile,
  task: string,
  fallback: string,
  locale: string,
  kind: 'quick_edit' | 'location',
): readonly StepCandidate[] {
  const t = file.tasks?.[task];
  if (t === undefined) return [];
  const props = file.types?.[subjectTypeOf(file, task, fallback)]?.properties ?? {};
  const taken = new Set([...Object.keys(t.form ?? {}), ...stepProperties(t)]);
  const stage = stagePropertyOf(file, task, fallback);
  return Object.entries(props)
    .filter(
      ([key, p]) => !taken.has(key) && key !== stage && (p.type === 'geometry') === (kind === 'location'),
    )
    .map(([key, p]) => ({ key, label: labelOf(p.label, locale, key) }));
}

/** "+ Formular", "+ Schnellbearbeitung" (with the picked properties) or "+ Standort" (with its geometry). */
export function addStepOps(doc: Doc, task: string, step: TaskStep): readonly Op[] {
  return stepsOps(doc, task, [...stepList(doc.effective(), task), step]);
}

/** A step moves one place (`by` -1 up, +1 down); the order is the order the participant does them in. */
export function moveStepOps(doc: Doc, task: string, index: number, by: -1 | 1): readonly Op[] {
  const list = [...stepList(doc.effective(), task)];
  const to = index + by;
  const step = list[index];
  if (step === undefined || to < 0 || to >= list.length) return [];
  list.splice(index, 1);
  list.splice(to, 0, step);
  return stepsOps(doc, task, list);
}

export function removeStepOps(doc: Doc, task: string, index: number): readonly Op[] {
  return stepsOps(
    doc,
    task,
    stepList(doc.effective(), task).filter((_, i) => i !== index),
  );
}

/** Replaces a step of the list (the picked properties of a quick edit, the property of a location). */
export function replaceStepOps(doc: Doc, task: string, index: number, step: TaskStep): readonly Op[] {
  return stepsOps(
    doc,
    task,
    stepList(doc.effective(), task).map((s, i) => (i === index ? step : s)),
  );
}
