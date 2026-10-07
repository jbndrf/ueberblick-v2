/**
 * The Ergebnisse tab's edits (v3 `TaskConfigSidebar.svelte:423-444`, `EffectListEditor.svelte`): the task's
 * `then` steps, its `creates` and "Übergang zu" as Doc ops, pure like `ops.ts` (R1). v3's effects map as the
 * register says: transition = the `then` step that sets the stage property (one op with the canvas arrow,
 * `lenses/process/edit.ts`), set_field and compute = `set` with a literal or an expression, clear_field =
 * `set: null`, set_instance_status = `set` on a select property, create_instance = the task's `creates`,
 * and (new, WP-305) `lifecycle`. v3's snapshot has no engine home (E10) and is not offered.
 */
import { LIFECYCLE_STATES, type LifecycleState, type Property, type TemplateFile } from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { clearOps, setOps } from '../../lenses/task/edit';
import { deriveProcesses, EDGE_ORIGINS, literalOption, pinnedOptions } from '../../lenses/process/graph';
import { connectOps, noEmptyThen, removeOps, retargetOps } from '../../lenses/process/edit';
import { textValue } from '../../lenses/task/model';
import { stageSourceOf } from './ops';
import { subjectTypeOf } from './step-ops';

export type ThenStep = NonNullable<NonNullable<TemplateFile['tasks']>[string]['then']>[number];

/** The kinds of row the action list shows; `redact` is read-only here (the YAML tab edits it). */
export const OUTCOME_KINDS = ['set', 'clear', 'status', 'lifecycle', 'redact'] as const;
export type OutcomeKind = (typeof OUTCOME_KINDS)[number];

/** The kinds the "+" buttons add (v3's add buttons: set, clear, status, create; lifecycle is new). */
export const ADDABLE_OUTCOMES = ['set', 'clear', 'status', 'create', 'lifecycle'] as const;
export type AddableOutcome = (typeof ADDABLE_OUTCOMES)[number];

const at = (task: string): string => `tasks.${task}`;
/** A `then.set` value: a string is an expression, other scalars are literals. */
export type SetValue = string | number | boolean | null;

const quote = (option: string): string => `'${option}'`;

export interface OutcomeRow {
  /** Position in `tasks.<t>.then`. */
  readonly index: number;
  readonly kind: OutcomeKind;
  readonly step: ThenStep;
}

function propsOf(file: TemplateFile, task: string, fallback: string): Readonly<Record<string, Property>> {
  return file.types?.[subjectTypeOf(file, task, fallback)]?.properties ?? {};
}

/** The index of the step "Übergang zu" shows: the one unconditional arrow of the task (as the canvas draws it). */
export function transitionIndex(file: TemplateFile, task: string, fallback: string): number | undefined {
  const source = stageSourceOf(file, task, fallback);
  if (source === undefined) return undefined;
  const edge = deriveProcesses(file, source.type)[0]?.edges.find(
    (e) =>
      e.origin === EDGE_ORIGINS.task &&
      e.key === task &&
      e.step !== undefined &&
      e.when === undefined &&
      e.otherwise === undefined &&
      Object.keys(file.tasks?.[task]?.then?.[e.step]?.set ?? {}).length === 1,
  );
  return edge?.step;
}

/** The stage `to` of the task's unconditional arrow (`undefined`: none). */
export function transitionTarget(file: TemplateFile, task: string, fallback: string): string | undefined {
  const i = transitionIndex(file, task, fallback);
  const source = stageSourceOf(file, task, fallback);
  const step = i === undefined ? undefined : file.tasks?.[task]?.then?.[i];
  return step === undefined || source === undefined ? undefined : literalOption(step.set?.[source.property]);
}

/** Why "Übergang zu" cannot be written: the type has no process, or the task is offered in several stages. */
export const TRANSITION_REFUSALS = { noProcess: 'no_process', pinned: 'pinned' } as const;
export type TransitionRefusal = (typeof TRANSITION_REFUSALS)[keyof typeof TRANSITION_REFUSALS];

export type TransitionResult =
  | { readonly ok: true; readonly ops: readonly Op[] }
  | { readonly ok: false; readonly reason: TransitionRefusal };

/** "Übergang zu" `to` (`undefined`: no transition): the same ops as the process lens' arrow (R1). */
export function transitionOps(
  doc: Doc,
  task: string,
  fallback: string,
  to: string | undefined,
): TransitionResult {
  const file = doc.effective();
  const source = stageSourceOf(file, task, fallback);
  if (source === undefined) return { ok: false, reason: TRANSITION_REFUSALS.noProcess };
  const i = transitionIndex(file, task, fallback);
  const edge =
    i === undefined
      ? undefined
      : deriveProcesses(file, source.type)[0]?.edges.find(
          (e) => e.origin === EDGE_ORIGINS.task && e.key === task && e.step === i,
        );
  const done = (r: ReturnType<typeof connectOps>): TransitionResult =>
    r.ok
      ? { ok: true, ops: r.ops.flatMap((op) => noEmptyThen(doc, op)) }
      : { ok: false, reason: TRANSITION_REFUSALS.pinned };
  if (to === undefined)
    return edge === undefined ? { ok: true, ops: [] } : done(removeOps(file, edge, source.property));
  if (edge !== undefined) return done(retargetOps(file, edge, source.property, to));
  const t = file.tasks?.[task];
  const pinned = t === undefined ? undefined : pinnedOptions(t.when, source.property);
  const from = pinned?.[0];
  const r = connectOps(file, {
    type: source.type,
    property: source.property,
    to,
    carrier: { task },
    ...(from === undefined ? {} : { from }),
  });
  return done(r);
}

function kindOf(step: ThenStep, props: Readonly<Record<string, Property>>): OutcomeKind {
  if (step.lifecycle !== undefined) return 'lifecycle';
  if (step.redact !== undefined) return 'redact';
  const entries = Object.entries(step.set ?? {});
  if (entries.length === 1 && entries[0]?.[1] === null) return 'clear';
  const [key, value] = entries[0] ?? [];
  if (
    entries.length === 1 &&
    key !== undefined &&
    props[key]?.type === 'select' &&
    literalOption(value) !== undefined
  )
    return 'status';
  return 'set';
}

/** The action list: every `then` step except the one "Übergang zu" shows. */
export function outcomeRows(file: TemplateFile, task: string, fallback: string): readonly OutcomeRow[] {
  const then = file.tasks?.[task]?.then ?? [];
  const arrow = transitionIndex(file, task, fallback);
  const props = propsOf(file, task, fallback);
  return then.flatMap((step, index) => (index === arrow ? [] : [{ index, kind: kindOf(step, props), step }]));
}

/** The whole `then` list; a list is atomic in the overlay (A-005). An empty list removes `then`. */
export function setThenOps(doc: Doc, task: string, steps: readonly ThenStep[]): readonly Op[] {
  return steps.length === 0 ? clearOps(doc, `${at(task)}.then`) : setOps(doc, `${at(task)}.then`, steps);
}

const thenOf = (doc: Doc, task: string): readonly ThenStep[] => doc.effective().tasks?.[task]?.then ?? [];

const replaced = (list: readonly ThenStep[], i: number, step: ThenStep): readonly ThenStep[] =>
  list.map((s, j) => (j === i ? step : s));

/** The value a new `set` row on `prop` starts with: one the checker accepts for its type. */
export function startSetValue(prop: Property | undefined): SetValue {
  switch (prop?.type) {
    case 'text':
      return "''";
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return true;
    case 'select':
      return quote(Object.keys(prop.options ?? {})[0] ?? '');
    default:
      return null;
  }
}

/** Why a "+" button adds nothing. */
export const ADD_REFUSALS = {
  secondCreate: 'second_create',
  noProperty: 'no_property',
  noSelect: 'no_select',
} as const;
export type AddRefusal = (typeof ADD_REFUSALS)[keyof typeof ADD_REFUSALS];

export type AddResult =
  { readonly ok: true; readonly ops: readonly Op[] } | { readonly ok: false; readonly reason: AddRefusal };

/** One of the "+" buttons: appends a step (or sets `creates`; a task creates at most one feature type). */
export function addOutcomeOps(doc: Doc, task: string, fallback: string, kind: AddableOutcome): AddResult {
  const file = doc.effective();
  const t = file.tasks?.[task];
  if (t === undefined) return { ok: false, reason: ADD_REFUSALS.noProperty };
  if (kind === 'create') {
    if (t.creates !== undefined) return { ok: false, reason: ADD_REFUSALS.secondCreate };
    const type = file.types?.[fallback] === undefined ? Object.keys(file.types ?? {})[0] : fallback;
    return type === undefined
      ? { ok: false, reason: ADD_REFUSALS.noProperty }
      : { ok: true, ops: setOps(doc, `${at(task)}.creates`, type) };
  }
  const props = Object.entries(propsOf(file, task, fallback));
  const stage = stageSourceOf(file, task, fallback)?.property;
  const plain = props.filter(([k, p]) => k !== stage && p.type !== 'geometry');
  const first =
    (kind === 'set' ? plain.find(([, p]) => p.type !== 'select' && startSetValue(p) !== null) : undefined) ??
    plain[0] ??
    props[0];
  let step: ThenStep;
  if (kind === 'lifecycle') step = { lifecycle: 'completed' };
  else if (first === undefined) return { ok: false, reason: ADD_REFUSALS.noProperty };
  else if (kind === 'clear') step = { set: { [first[0]]: null } };
  else if (kind === 'status') {
    const sel = props.find(([k, p]) => k !== stage && p.type === 'select');
    if (sel === undefined) return { ok: false, reason: ADD_REFUSALS.noSelect };
    step = { set: { [sel[0]]: startSetValue(sel[1]) } };
  } else step = { set: { [first[0]]: startSetValue(first[1]) } };
  return { ok: true, ops: setThenOps(doc, task, [...thenOf(doc, task), step]) };
}

/** The `creates` type (a select of the file's Objektarten); `$map` tasks keep theirs (Einstiegs-Task owns it). */
export const createTypeOps = (doc: Doc, task: string, type: string): readonly Op[] =>
  setOps(doc, `${at(task)}.creates`, type);

export const removeCreateOps = (doc: Doc, task: string): readonly Op[] =>
  clearOps(doc, `${at(task)}.creates`);

/** A row's property changes: the value restarts at what suits the new property (a clear stays a clear). */
export function setPropertyOps(
  doc: Doc,
  task: string,
  fallback: string,
  index: number,
  key: string,
): readonly Op[] {
  const step = thenOf(doc, task)[index];
  const old = Object.keys(step?.set ?? {})[0];
  if (step === undefined || old === undefined) return [];
  const clearing = step.set?.[old] === null;
  const value = clearing ? null : startSetValue(propsOf(doc.effective(), task, fallback)[key]);
  return setThenOps(doc, task, replaced(thenOf(doc, task), index, { ...step, set: { [key]: value } }));
}

/** A row's value as typed ("Wert oder Ausdruck": a string is an expression; true, false, null and numbers are literals). */
export function setValueOps(doc: Doc, task: string, index: number, text: string): readonly Op[] {
  const step = thenOf(doc, task)[index];
  const key = Object.keys(step?.set ?? {})[0];
  const value = textValue(text) as SetValue;
  if (step === undefined || key === undefined || value === '') return [];
  return setThenOps(doc, task, replaced(thenOf(doc, task), index, { ...step, set: { [key]: value } }));
}

export function setLifecycleOps(doc: Doc, task: string, index: number, state: LifecycleState): readonly Op[] {
  const step = thenOf(doc, task)[index];
  if (step === undefined || !LIFECYCLE_STATES.keys.includes(state)) return [];
  return setThenOps(doc, task, replaced(thenOf(doc, task), index, { ...step, lifecycle: state }));
}

/** "immer" (no condition), "nur wenn …" (`when`) or "sonst" (`otherwise`): the step's condition. */
export const WHEN_MODES = ['always', 'when', 'otherwise'] as const;
export type WhenMode = (typeof WHEN_MODES)[number];

export const whenModeOf = (step: ThenStep): WhenMode =>
  step.otherwise === true ? 'otherwise' : step.when !== undefined ? 'when' : 'always';

/** Sets the condition: `source` for "nur wenn" (empty text: still "nur wenn", with `true` until a row is added). */
export function setStepWhenOps(
  doc: Doc,
  task: string,
  index: number,
  mode: WhenMode,
  source = '',
): readonly Op[] {
  const step = thenOf(doc, task)[index];
  if (step === undefined) return [];
  const rest = Object.fromEntries(
    Object.entries(step).filter(([k]) => k !== 'when' && k !== 'otherwise'),
  ) as ThenStep;
  const next: ThenStep =
    mode === 'otherwise'
      ? { ...rest, otherwise: true }
      : mode === 'when' && source.trim() !== ''
        ? { ...rest, when: source.trim() }
        : rest;
  return setThenOps(doc, task, replaced(thenOf(doc, task), index, next));
}

export function removeOutcomeOps(doc: Doc, task: string, index: number): readonly Op[] {
  return setThenOps(
    doc,
    task,
    thenOf(doc, task).filter((_, i) => i !== index),
  );
}

/** A step swaps places with the neighbouring row (`by` -1 up, +1 down); the transition step keeps its place. */
export function moveOutcomeOps(
  doc: Doc,
  task: string,
  rows: readonly OutcomeRow[],
  row: number,
  by: -1 | 1,
): readonly Op[] {
  const a = rows[row];
  const b = rows[row + by];
  if (a === undefined || b === undefined) return [];
  const list = [...thenOf(doc, task)];
  list[a.index] = b.step;
  list[b.index] = a.step;
  return setThenOps(doc, task, list);
}
