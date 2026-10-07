/**
 * What a canvas gesture writes, as document ops (WP-435, S4-4). Pure functions of the Doc and the canvas
 * model, so the pointer, the keyboard path and an assistant (H4) end up in the same ops (R1): an arrow is
 * the process lens' `connectOps` / `retargetOps` / `removeOps`, a new button is the stage pane's
 * `addButton` or the catalog's task chip, and the order of the buttons is the overlay `order` of `tasks`
 * (WP-333). v3 wrote these through its task store (`TaskCanvas.svelte:295` onConnect, `:306` onDelete,
 * `:249-258` reorderWithin).
 */
import type { TemplateFile } from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { CONNECT_REFUSALS, connectOps, noEmptyThen, removeOps, retargetOps } from '../../lenses/process/edit';
import { EDGE_ORIGINS } from '../../lenses/process/graph';
import { CREATE_REFUSALS, createOp, type NewNames } from '../catalog/ops';
import { stageOps } from '../stage/ops';
import { nodeId, type CanvasModel } from './model';

/** Why a gesture writes nothing: the lens' reasons, plus the ones only the canvas can have. */
export const CANVAS_REFUSALS = {
  ...CONNECT_REFUSALS,
  /** The arrow does not start at a task button (a rule or an entry marker has no exit to draw from). */
  notTask: 'not_task',
  /** The arrow does not end at a phase. */
  notStage: 'not_stage',
  /** The Objektart has no process: there is no phase property to write. */
  noProcess: 'no_process',
} as const;
export type CanvasRefusal = (typeof CANVAS_REFUSALS)[keyof typeof CANVAS_REFUSALS];

export type ArrowResult =
  { readonly ok: true; readonly ops: readonly Op[] } | { readonly ok: false; readonly reason: CanvasRefusal };

const STAGE_PREFIX = 'stage:';
const stageOf = (id: string): string | undefined =>
  id.startsWith(STAGE_PREFIX) ? id.slice(STAGE_PREFIX.length) : undefined;

export interface Drawn {
  /** The node the line leaves (`nodeId.stage(key)` or `nodeId.global`), the task key of its exit dot, the node it ends at. */
  readonly source: string;
  readonly handle: string;
  readonly target: string;
}

/** Draws an arrow from a task button's exit dot to a phase (v3 `onConnect`). */
export function drawArrow(doc: Doc, model: CanvasModel, type: string, c: Drawn): ArrowResult {
  if (model.property === undefined) return { ok: false, reason: CANVAS_REFUSALS.noProcess };
  const to = stageOf(c.target);
  if (to === undefined) return { ok: false, reason: CANVAS_REFUSALS.notStage };
  const sourceStage = stageOf(c.source);
  if (sourceStage === undefined && c.source !== nodeId.global) {
    return { ok: false, reason: CANVAS_REFUSALS.notTask };
  }
  const r = connectOps(doc.effective(), {
    type,
    property: model.property,
    to,
    carrier: { task: c.handle },
    ...(sourceStage === undefined ? {} : { from: sourceStage }),
  });
  return r.ok ? { ok: true, ops: r.ops.flatMap((op) => noEmptyThen(doc, op)) } : r;
}

/** The task arrow with this id, as the process lens derived it. */
const edgeOf = (model: CanvasModel, id: string) =>
  model.process?.edges.find((e) => e.id === id && e.origin === EDGE_ORIGINS.task);

/** Moves the end of an arrow to another phase (the end of the line dragged there). */
export function retargetArrow(doc: Doc, model: CanvasModel, arrow: string, target: string): ArrowResult {
  const edge = edgeOf(model, arrow);
  if (edge === undefined || model.property === undefined)
    return { ok: false, reason: CANVAS_REFUSALS.notTask };
  const to = stageOf(target);
  if (to === undefined) return { ok: false, reason: CANVAS_REFUSALS.notStage };
  if (to === edge.to) return { ok: true, ops: [] };
  const r = retargetOps(doc.effective(), edge, model.property, to);
  return r.ok ? { ok: true, ops: r.ops } : r;
}

/** Deletes an arrow (v3 `onDelete`): the button stays, only its move to another phase goes. */
export function removeArrow(doc: Doc, model: CanvasModel, arrow: string): ArrowResult {
  const edge = edgeOf(model, arrow);
  if (edge === undefined || model.property === undefined)
    return { ok: false, reason: CANVAS_REFUSALS.notTask };
  const r = removeOps(doc.effective(), edge, model.property);
  return r.ok ? { ok: true, ops: r.ops.flatMap((op) => noEmptyThen(doc, op)) } : r;
}

/**
 * The `order` op that puts `dragged` before `before` (the end when `null`) among the buttons of one scope
 * (a phase or the global container). Tasks of other scopes keep their places: the scope's keys only swap
 * among the slots they already hold. No op when nothing would move.
 */
export function reorderOps(
  file: TemplateFile,
  scope: readonly string[],
  dragged: string,
  before: string | null,
): readonly Op[] {
  const all = Object.keys(file.tasks ?? {});
  if (!scope.includes(dragged) || before === dragged) return [];
  const next = scope.filter((k) => k !== dragged);
  const at = before === null ? next.length : next.indexOf(before);
  next.splice(at < 0 ? next.length : at, 0, dragged);
  const slots = all.flatMap((k, i) => (scope.includes(k) ? [i] : []));
  const keys = [...all];
  slots.forEach((slot, i) => (keys[slot] = next[i] as string));
  return keys.every((k, i) => k === all[i]) ? [] : [{ kind: 'order', path: 'tasks', keys }];
}

/** Moves a button one place (`by` -1 up, +1 down) within its scope: the keyboard path of the drag. */
export function nudgeOps(
  file: TemplateFile,
  scope: readonly string[],
  task: string,
  by: -1 | 1,
): readonly Op[] {
  const i = scope.indexOf(task);
  if (i < 0) return [];
  if (by === -1) return i === 0 ? [] : reorderOps(file, scope, task, scope[i - 1] as string);
  return i === scope.length - 1 ? [] : reorderOps(file, scope, task, scope[i + 2] ?? null);
}

export type AddTaskResult =
  | { readonly ok: true; readonly ops: readonly Op[]; readonly key: string }
  | { readonly ok: false; readonly reason: 'no_process' };

/**
 * A new button: in a phase it is pinned to it by its `when` (the stage pane's "Aktionsschaltfläche hinzufügen"),
 * in the global container it has no condition. `form` is the catalog's "Formular" chip (a task with a form).
 */
export function addTaskOps(
  file: TemplateFile,
  type: string,
  scope: string | null,
  locale: string,
  names: NewNames,
  form = false,
): AddTaskResult {
  if (scope !== null) {
    const r = stageOps.addButton(file, type, scope, locale, names.task);
    if (!r.ok) return { ok: false, reason: CREATE_REFUSALS.noProcess };
    const op: Op =
      form && r.op.kind === 'add' ? { ...r.op, value: { ...(r.op.value as object), form: {} } } : r.op;
    return { ok: true, key: r.key, ops: [op] };
  }
  const r = createOp(file, type, { kind: 'task', task: form ? 'form' : 'button' }, locale, names);
  if (!r.ok || r.select.id === undefined) return { ok: false, reason: CREATE_REFUSALS.noProcess };
  return { ok: true, key: r.select.id, ops: [r.op] };
}
