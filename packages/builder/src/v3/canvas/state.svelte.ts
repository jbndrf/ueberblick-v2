/**
 * What the canvas does when the admin edits on it (WP-435, S4-4; v3 `TaskCanvas.svelte:117-145, 295-330, 396`):
 * one place for the nodes, so each node component only says what was done to it. Every write is a pure op
 * from `edit.ts`, the panes' ops or `step-copy.ts`, tried by `commitOps` first (a refusal, a template lock or a
 * new problem comes back as a note, nothing is half applied) and applied through the frame's `apply`.
 */
import type { Op } from '../../doc';
import { labelOf } from '../../shell/location';
import type { CatalogCreate } from '../catalog/ops';
import { createOp } from '../catalog/ops';
import { createLocked } from '../catalog/lock';
import { refusalText } from '../shell/refusal';
import { commitRuleOps } from '../rule/commit';
import { deleteOps as deleteRuleOps } from '../rule/ops';
import { autoAt, autoLabel, autoOf } from '../rule/auto-task';
import type { BuilderContext } from '../shell/context';
import type { Selection } from '../shell/registry';
import { stageDeleteImpact } from '../stage/ops';
import { commitOps } from '../task/commit';
import { deleteOps as deleteTaskOps, dependentRules } from '../task/ops';
import { addStepOps, removeStepOps } from '../task/step-ops';
import { deleteItem, hides, hideBodyKey, hideTitleKey, resetItems } from './provenance';
import { ELEMENT_KINDS, type ElementRef } from '../shared/provenance-elements';
import { copyText } from '../shared/clipboard';
import { copyStepOps, type StepCopyRefusal } from '../model/step-copy';
import {
  addTaskOps,
  drawArrow,
  nudgeOps,
  removeArrow,
  reorderOps,
  retargetArrow,
  type ArrowResult,
  type CanvasRefusal,
  type Drawn,
} from './edit';
import { TOOL_KINDS, type CanvasModel, type ToolKind } from './model';

export interface MenuItem {
  readonly label: string;
  readonly destructive?: boolean;
  /** Locked by the template (WP-454). */
  readonly disabled?: boolean;
  readonly run: () => void;
}
export interface MenuState {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly items: readonly MenuItem[];
  /** Where focus goes back to when the menu closes. */
  readonly returnTo?: HTMLElement;
}
/** The confirm dialog of a delete: what goes, and what it leaves dangling (v3 `ConfirmDeleteDialog`). */
export interface ConfirmRequest {
  readonly title: string;
  readonly impact: readonly string[];
  readonly lead?: string;
  /** The element comes from the template: the dialog hides it instead of deleting it (WP-454). */
  readonly hide?: { readonly body: string };
  readonly run: () => void;
}
/** A tool icon picked up with the keyboard, waiting for a button to be dropped on. */
export interface Carried {
  readonly task: string;
  readonly index: number;
  readonly kind: ToolKind;
}

/** A scope of buttons: a phase key, or `null` for the global container. */
export type Scope = string | null;

const NOTE: Record<CanvasRefusal | StepCopyRefusal, Parameters<BuilderContext['t']>[0] | undefined> = {
  exists: 'canvas_note_exists',
  task_pinned: 'canvas_note_task_pinned',
  unknown_task: 'canvas_note_unknown',
  unknown: 'canvas_note_unknown',
  not_task: 'canvas_note_not_task',
  not_stage: 'canvas_note_not_stage',
  no_process: 'canvas_note_no_process',
  has_form: 'canvas_note_has_form',
  property: 'canvas_note_property',
  same: undefined,
};

const TOOL_LABEL: Record<ToolKind, Parameters<BuilderContext['t']>[0]> = {
  [TOOL_KINDS.form]: 'canvas_tool_form',
  [TOOL_KINDS.edit]: 'canvas_tool_edit',
  [TOOL_KINDS.location]: 'canvas_tool_location',
};

export function createCanvasState(ctx: BuilderContext, model: () => CanvasModel) {
  let note = $state('');
  let confirm = $state<ConfirmRequest | undefined>();
  let confirmOpen = $state(false);
  let menu = $state<MenuState | undefined>();
  let carried = $state<Carried | undefined>();

  const names = () => ({
    task: ctx.t('catalog_new_task'),
    entry: ctx.t('catalog_new_entry'),
    stage: ctx.t('catalog_new_stage'),
    rule: ctx.t('catalog_new_rule'),
    process: ctx.t('catalog_new_process'),
    endStage: ctx.t('catalog_new_end_stage'),
  });
  const taskLabel = (key: string): string =>
    labelOf(ctx.doc().effective().tasks?.[key]?.label, ctx.locale, key);

  /** Tries and applies `ops`; the note says why not (a refusal of the template lock reads as the panes' do). */
  function commit(ops: readonly Op[], scope: string): boolean {
    const failed = commitOps(ctx, ops, scope);
    note = failed ?? '';
    return failed === undefined;
  }
  function refuse(reason: CanvasRefusal | StepCopyRefusal): void {
    const key = NOTE[reason];
    note = key === undefined ? '' : ctx.t(key);
  }
  function arrow(r: ArrowResult, scope: string): void {
    if (!r.ok) return refuse(r.reason);
    commit(r.ops, scope);
  }

  /** The keys of the buttons of a scope, in the order the canvas shows them. */
  function scopeKeys(scope: Scope): readonly string[] {
    const m = model();
    const list = scope === null ? m.global : (m.stages.find((s) => s.key === scope)?.tasks ?? []);
    return list.map((t) => t.key);
  }

  function apply(op: Op): boolean {
    const r = ctx.apply(op);
    note = '';
    return r.refused === undefined;
  }

  /** "Phase hinzufügen": the catalog's Phase chip (v3 `addStage`, `:117`). */
  /** The template locks what this create would write: the button is disabled with the lock wording (WP-515). */
  const createIsLocked = (req: CatalogCreate): boolean =>
    createLocked(ctx.doc(), ctx.type, req, ctx.locale, names());

  function create(req: CatalogCreate): Selection | undefined {
    const r = createOp(ctx.doc().effective(), ctx.type, req, ctx.locale, names());
    if (!r.ok) {
      note = ctx.t('canvas_note_no_process');
      return undefined;
    }
    // One create is one undoable change: a stage on a type without a process adds the property and the process.
    if ('refused' in ctx.applyBatch([r.op, ...(r.after ?? [])])) return undefined;
    note = '';
    ctx.select(r.select);
    return r.select;
  }

  /**
   * A catalog task chip dropped on the canvas (v3 `onDrop` (4), `:360-385`): a "Formular" chip on a button adds
   * its form step; on a phase or the global container, or anywhere else (global), it makes a new button.
   */
  function dropTaskChip(chip: 'button' | 'form', over: { task?: string; stage?: string }): void {
    if (over.task === undefined) return addTask(over.stage ?? null, chip === 'form');
    const task = over.task;
    if (chip === 'button') return ctx.select({ kind: 'task', id: task });
    if (ctx.doc().effective().tasks?.[task]?.form !== undefined) return refuse('has_form');
    if (commit(addStepOps(ctx.doc(), task, { kind: 'form' }), `tasks.${task}`))
      ctx.select({ kind: 'task', id: task });
  }

  /** "Button hinzufügen" at the end of a phase or the global container (v3 `onAddTask`). */
  function addTask(scope: Scope, form = false): void {
    const r = addTaskOps(ctx.doc().effective(), ctx.type, scope, ctx.locale, names(), form);
    if (!r.ok) return refuse(r.reason);
    if (commit(r.ops, `tasks.${r.key}`)) ctx.select({ kind: 'task', id: r.key });
  }

  function ask(request: ConfirmRequest): void {
    confirm = request;
    confirmOpen = true;
  }

  /** The confirm's wording for an element: a template element is hidden, not deleted (WP-454). */
  function hiding(
    ref: ElementRef,
    name: string,
    deleteTitle: string,
  ): Pick<ConfirmRequest, 'title' | 'hide'> {
    if (!hides(ctx, ref)) return { title: deleteTitle };
    return {
      title: ctx.t(hideTitleKey(ref.kind), { name }),
      hide: { body: ctx.t(hideBodyKey(ref.kind)) },
    };
  }
  /** A reset puts the element back to the template; the template passes its own check, so no new problem is expected. */
  function resetElement(ops: readonly Op[]): void {
    const r = ctx.applyBatch(ops);
    note = 'refused' in r ? refusalText(ctx.t, ctx.doc(), ops, r.refused, ctx.locale) : '';
  }

  function requestDeleteTask(task: string): void {
    const file = ctx.doc().effective();
    const name = taskLabel(task);
    const ref = { kind: ELEMENT_KINDS.task, key: task };
    ask({
      ...hiding(ref, name, ctx.t('tp_delete_title', { name })),
      impact: dependentRules(file, task).map((k) => autoLabel(file, k, ctx.locale)),
      run: () => {
        const doc = ctx.doc();
        if (commit(deleteTaskOps(doc, task), `tasks.${task}`)) {
          ctx.select({ kind: 'none' });
        }
      },
    });
  }

  function requestDeleteStage(stage: string): void {
    const impact = stageDeleteImpact(ctx.doc(), ctx.type, stage, ctx.locale);
    if (impact === undefined) return;
    const name = model().stages.find((s) => s.key === stage)?.label ?? stage;
    ask({
      ...hiding({ kind: ELEMENT_KINDS.stage, key: stage }, name, ctx.t('stage_delete_confirm', { name })),
      impact: impact.problems.map((p) => p.message),
      lead: ctx.t('stage_delete_impact'),
      run: () => {
        if (apply(impact.op)) ctx.select({ kind: 'none' });
      },
    });
  }

  function requestDeleteRule(rule: string): void {
    const doc = ctx.doc();
    const file = doc.effective();
    const run = autoOf(file, rule)?.task;
    const name = autoLabel(file, rule, ctx.locale);
    ask({
      ...hiding({ kind: ELEMENT_KINDS.rule, key: rule }, name, ctx.t('rp_delete_title', { name })),
      impact: run === undefined ? [] : [taskLabel(run)],
      lead: ctx.t('rp_delete_impact'),
      run: () => {
        const ops = deleteRuleOps(doc, rule);
        const scopes = [autoAt(rule), ...(run === undefined ? [] : [`tasks.${run}`])];
        const failed = commitRuleOps(ctx, ops, scopes);
        note = failed ?? '';
        if (failed === undefined) ctx.select({ kind: 'none' });
      },
    });
  }

  async function copyKey(key: string): Promise<void> {
    note = ctx.t((await copyText(key)) ? 'tp_key_copied' : 'tp_key_copy_failed');
  }

  /** v3 `Deletable`: the right-click menu at the pointer (the keyboard's context key reports the element's corner). */
  function openMenu(event: MouseEvent, label: string, items: readonly MenuItem[]): void {
    event.preventDefault();
    event.stopPropagation();
    const from = event.currentTarget as HTMLElement | null;
    const box = from?.getBoundingClientRect();
    const keyboard = event.clientX === 0 && event.clientY === 0 && box !== undefined;
    menu = {
      x: keyboard ? box.left + 8 : event.clientX,
      y: keyboard ? box.bottom - 8 : event.clientY,
      label,
      items,
      ...(from === null ? {} : { returnTo: from }),
    };
  }
  const taskRef = (key: string): ElementRef => ({ kind: ELEMENT_KINDS.task, key });
  const taskMenu = (key: string): readonly MenuItem[] => [
    { label: ctx.t('tp_key_copy'), run: () => void copyKey(key) },
    ...resetItems(ctx, taskRef(key), resetElement),
    deleteItem(ctx, taskRef(key), ctx.t('tp_delete'), () => requestDeleteTask(key)),
  ];
  const stageMenu = (key: string): readonly MenuItem[] => {
    const ref = { kind: ELEMENT_KINDS.stage, key };
    return [
      { label: ctx.t('tp_key_copy'), run: () => void copyKey(key) },
      ...resetItems(ctx, ref, resetElement),
      deleteItem(ctx, ref, ctx.t('canvas_menu_delete_stage'), () => requestDeleteStage(key)),
    ];
  };
  const ruleMenu = (key: string): readonly MenuItem[] => {
    const ref = { kind: ELEMENT_KINDS.rule, key };
    return [
      { label: ctx.t('tp_key_copy'), run: () => void copyKey(key) },
      ...resetItems(ctx, ref, resetElement),
      deleteItem(ctx, ref, ctx.t('rp_delete'), () => requestDeleteRule(key)),
    ];
  };
  const entryMenu = (key: string): readonly MenuItem[] => [
    ...resetItems(ctx, taskRef(key), resetElement),
    deleteItem(ctx, taskRef(key), ctx.t('tp_delete'), () => requestDeleteTask(key)),
  ];
  const toolMenu = (task: string, index: number): readonly MenuItem[] => [
    {
      label: ctx.t('canvas_menu_remove_tool'),
      run: () => commit(removeStepOps(ctx.doc(), task, index), `tasks.${task}`),
    },
  ];

  /** Puts the button `dragged` before `before` (or last) among the buttons of its scope (v3 `reorderWithin`). */
  function reorder(scope: Scope, dragged: string, before: string | null): void {
    commit(reorderOps(ctx.doc().effective(), scopeKeys(scope), dragged, before), 'tasks');
  }
  function nudge(scope: Scope, task: string, by: -1 | 1): void {
    commit(nudgeOps(ctx.doc().effective(), scopeKeys(scope), task, by), 'tasks');
  }

  /** Moves the tool icon `index` of `from` onto button `to`; Alt (or Ctrl, Meta) copies instead. */
  function dropTool(from: string, index: number, to: string, copy: boolean): void {
    const r = copyStepOps(ctx.doc(), from, index, to, copy, ctx.type);
    if (!r.ok) return refuse(r.reason);
    if (commit(r.ops, `tasks.${to}`)) ctx.select({ kind: 'task', id: to });
  }

  /** Keyboard: Space on a tool icon picks it up; Enter on a button drops it there; Escape lets it go. */
  function pickUp(task: string, index: number, kind: ToolKind): void {
    carried = { task, index, kind };
    note = ctx.t('canvas_carrying', {
      tool: ctx.t(TOOL_LABEL[kind]),
    });
  }
  function drop(to: string, copy: boolean): void {
    const c = carried;
    carried = undefined;
    note = '';
    if (c !== undefined) dropTool(c.task, c.index, to, copy);
  }
  function cancelCarry(): void {
    carried = undefined;
    note = '';
  }

  const connect = (c: Drawn): void => arrow(drawArrow(ctx.doc(), model(), ctx.type, c), `tasks.${c.handle}`);
  const reconnect = (id: string, target: string): void => {
    const edge = model().process?.edges.find((e) => e.id === id);
    arrow(retargetArrow(ctx.doc(), model(), id, target), `tasks.${edge?.key ?? ''}`);
  };
  const disconnect = (id: string): void => {
    const edge = model().process?.edges.find((e) => e.id === id);
    arrow(removeArrow(ctx.doc(), model(), id), `tasks.${edge?.key ?? ''}`);
  };

  return {
    get note() {
      return note;
    },
    set note(v: string) {
      note = v;
    },
    get confirm() {
      return confirm;
    },
    get confirmOpen() {
      return confirmOpen;
    },
    set confirmOpen(v: boolean) {
      confirmOpen = v;
    },
    get menu() {
      return menu;
    },
    set menu(v: MenuState | undefined) {
      menu = v;
    },
    get carried() {
      return carried;
    },
    toolLabel: (kind: ToolKind): string => ctx.t(TOOL_LABEL[kind]),
    create,
    createIsLocked,
    addTask,
    dropTaskChip,
    openMenu,
    taskMenu,
    stageMenu,
    ruleMenu,
    entryMenu,
    toolMenu,
    reorder,
    nudge,
    dropTool,
    pickUp,
    drop,
    cancelCarry,
    connect,
    reconnect,
    disconnect,
    scopeKeys,
  };
}

export type CanvasState = ReturnType<typeof createCanvasState>;
