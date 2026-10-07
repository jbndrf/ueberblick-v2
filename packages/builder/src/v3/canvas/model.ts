/**
 * What the canvas draws (v3 `TaskCanvas.svelte:1-16`): stage cards with their task buttons, the
 * global container for tasks without a stage, one entry marker per entry task, one rule node per
 * rule and the arrows. A pure function of the Doc, derived from the process graph (`lenses/process`)
 * so nothing is stored (docs/08): an arrow is a `then` step of a task that sets the stage property.
 */
import { processesOf, stepsOf, type TaskStepKind, type TemplateFile } from '@ueberblick/core';
import type { Doc } from '../../doc';
import {
  deriveProcesses,
  EDGE_ORIGINS,
  pinnedOptions,
  taskOfferedOn,
  type Process,
  type TaskDef,
} from '../../lenses/process/graph';
import { buildRules, type RuleView } from '../../lenses/rules/model';
import { labelOf } from '../../shell/location';
import { childLinks, parentLinks, subprocessLinks } from './subprocess';
import { isAutomaticOnly, ownedTasks } from '../rule/auto-task';

/** What kind of stage a card is (v3 `StageType`); drives the colour and the marker icon. */
export const STAGE_KINDS = { start: 'start', step: 'step', end: 'end' } as const;
export type StageKind = (typeof STAGE_KINDS)[keyof typeof STAGE_KINDS];

/** What draws an arrow: a task button, a rule, or an entry marker (v3 `entry-edge`). */
export const CANVAS_ORIGINS = { ...EDGE_ORIGINS, entry: 'entry' } as const;
export type CanvasOrigin = (typeof CANVAS_ORIGINS)[keyof typeof CANVAS_ORIGINS];

/** The tool icons of a task button (v3 `toolIcon`): one per step of the task, in the order it runs them. */
export const TOOL_KINDS = { form: 'form', edit: 'edit', location: 'location' } as const;
export type ToolKind = (typeof TOOL_KINDS)[keyof typeof TOOL_KINDS];

/** The canvas node ids; one place so the model, the layout and the nodes agree. */
export const nodeId = {
  stage: (key: string) => `stage:${key}`,
  global: 'global',
  rule: (key: string) => `rule:${key}`,
  entry: (key: string) => `entry:${key}`,
} as const;

export interface TaskButton {
  readonly key: string;
  readonly label: string;
  readonly tools: readonly ToolKind[];
  /** The task creates a feature of another type (v3 "spawns a daughter instance"). */
  readonly spawns: boolean;
  /** An arrow leaves this button (v3 `isTransition`: a filled exit dot). */
  readonly transitions: boolean;
  /** Only the system can run it and no single rule owns it: drawn with the automatic mark, not pressable in the preview (C-004). */
  readonly automatic: boolean;
  /** The sub-process this task starts: the child Objektart and its process name (S4-5, `subprocess.ts`). */
  readonly child?: { readonly type: string; readonly label: string };
}

export interface StageCard {
  readonly key: string;
  readonly label: string;
  readonly kind: StageKind;
  readonly tasks: readonly TaskButton[];
}

export interface EntryMarker {
  readonly key: string;
  readonly label: string;
}

export interface RuleChip {
  readonly key: string;
  readonly label: string;
  readonly trigger: RuleView['trigger'];
  /** The label of the task the rule runs. */
  readonly runLabel: string;
  /** The task the rule runs. */
  readonly run: string;
  /** The rule owns that task: it is the automatic action's outcome, never a button (C-004). */
  readonly owns: boolean;
  readonly spawns: boolean;
}

export interface CanvasArrow {
  readonly id: string;
  readonly origin: CanvasOrigin;
  /** The node the arrow leaves; `handle` is the task, rule or entry key of its exit dot. */
  readonly source: string;
  readonly handle: string;
  readonly target: string;
  readonly otherwise: boolean;
  /** The button, rule or entry label, for the accessible name. */
  readonly label: string;
  /** Several arrows between the same pair: this one's place among them (v3 `curveOffset`). */
  readonly slot: number;
  readonly slots: number;
  /** An arrow runs the other way between the same pair. */
  readonly reversed: boolean;
}

export interface CanvasModel {
  /** The type declares a process; without one only the global container, entries and rules show. */
  readonly hasProcess: boolean;
  /** The Objektarten this one is a sub-process of (S4-5); the canvas links back to each. */
  readonly parents: readonly { readonly type: string; readonly label: string }[];
  readonly property?: string;
  /** The derived process graph, which the automatic layout reads (lenses/process/layout.ts). */
  readonly process?: Process;
  readonly stages: readonly StageCard[];
  readonly global: readonly TaskButton[];
  readonly entries: readonly EntryMarker[];
  readonly rules: readonly RuleChip[];
  readonly arrows: readonly CanvasArrow[];
}

type RawArrow = Omit<CanvasArrow, 'slot' | 'slots' | 'reversed'>;

/** The icon of each step kind (registry `TASK_STEP_KINDS`; a new kind must say its icon here, the type checks it). */
const ICON_OF_STEP: Record<TaskStepKind, ToolKind> = {
  form: TOOL_KINDS.form,
  quick_edit: TOOL_KINDS.edit,
  location: TOOL_KINDS.location,
};

/** One icon per step, so the icon at index i is step i: the drag moves it by that index. */
function toolsOf(task: TaskDef): readonly ToolKind[] {
  return stepsOf(task).map((s) => ICON_OF_STEP[s.kind]);
}

export function buildCanvas(doc: Doc, type: string, locale: string): CanvasModel {
  const file: TemplateFile = doc.effective();
  const featureType = file.types?.[type];
  const declared = featureType === undefined ? undefined : processesOf(featureType)[0];
  const process = deriveProcesses(file, type)[0];
  const property = declared?.property;
  const owned = ownedTasks(file);
  // An owned task is the outcome of its automatic action, never a button (C-004 step 1).
  const taskEntries = Object.entries(file.tasks ?? {}).filter(([k]) => !owned.has(k));
  const isEntry = (t: TaskDef): boolean => t.on === '$map' && t.creates === type;
  const labelFor = (key: string): string => labelOf(file.tasks?.[key]?.label, locale, key);
  const stageKeys = new Set<string>(declared?.options ?? []);

  const withArrow = new Set<string>();
  for (const e of process?.edges ?? []) if (e.origin === EDGE_ORIGINS.task) withArrow.add(e.key);
  const links = subprocessLinks(file, locale);
  const childOf = new Map(
    childLinks(links, type).map((l) => [l.task, { type: l.child, label: l.childLabel }]),
  );
  const button = (key: string, task: TaskDef): TaskButton => {
    const child = childOf.get(key);
    return {
      key,
      label: labelFor(key),
      tools: toolsOf(task),
      spawns: task.creates !== undefined && task.creates !== type,
      transitions: withArrow.has(key),
      automatic: isAutomaticOnly(file, key),
      ...(child !== undefined ? { child } : {}),
    };
  };

  // Where each task's button stands: the stages its condition or its arrows start in, else global.
  const where = new Map<string, Set<string | undefined>>();
  const put = (task: string, stage: string | undefined): void => {
    const set = where.get(task) ?? new Set<string | undefined>();
    set.add(stage);
    where.set(task, set);
  };
  for (const [key, task] of taskEntries) {
    if (isEntry(task) || !taskOfferedOn(task, type)) continue;
    const pins = property === undefined ? [] : (pinnedOptions(task.when, property) ?? []);
    for (const p of pins) if (stageKeys.has(p)) put(key, p);
  }
  for (const e of process?.edges ?? []) {
    if (e.origin !== EDGE_ORIGINS.task) continue;
    put(e.key, e.from !== undefined && stageKeys.has(e.from) ? e.from : undefined);
  }
  for (const n of process?.nodes ?? []) for (const k of n.tasks) put(k, n.option);
  for (const [key, task] of taskEntries) {
    if (!isEntry(task) && taskOfferedOn(task, type) && !where.has(key)) put(key, undefined);
  }
  const inStage = (stage: string | undefined): TaskButton[] =>
    taskEntries.flatMap(([key, task]) => (where.get(key)?.has(stage) ? [button(key, task)] : []));

  const stages = (process?.nodes ?? []).map((n): StageCard => ({
    key: n.option,
    label: labelOf(n.label, locale, n.option),
    kind: (declared?.end as readonly string[] | undefined)?.includes(n.option)
      ? STAGE_KINDS.end
      : n.option === declared?.start
        ? STAGE_KINDS.start
        : STAGE_KINDS.step,
    tasks: inStage(n.option),
  }));

  const entries = taskEntries.filter(([, t]) => isEntry(t)).map(([key]) => ({ key, label: labelFor(key) }));
  const shown = new Set(
    Object.entries(file.tasks ?? {})
      .filter(([, t]) => isEntry(t) || taskOfferedOn(t, type))
      .map(([k]) => k),
  );
  const rules = buildRules(doc, locale)
    .filter((r) => shown.has(r.run))
    .map((r): RuleChip => {
      const run = file.tasks?.[r.run];
      return {
        key: r.key,
        label: r.label,
        trigger: r.trigger,
        runLabel: r.runLabel,
        run: r.run,
        owns: owned.has(r.run),
        spawns: run?.creates !== undefined && run.creates !== type,
      };
    });

  const raw: RawArrow[] = [];
  for (const e of process?.edges ?? []) {
    const target = nodeId.stage(e.to);
    if (e.origin === EDGE_ORIGINS.task) {
      if (owned.has(e.key)) continue; // drawn from its automatic action's node instead
      const source = e.from !== undefined && stageKeys.has(e.from) ? nodeId.stage(e.from) : nodeId.global;
      raw.push({
        id: e.id,
        origin: CANVAS_ORIGINS.task,
        source,
        handle: e.key,
        target,
        otherwise: e.otherwise === true,
        label: labelFor(e.key),
      });
    } else {
      const label = rules.find((r) => r.key === e.key)?.label ?? e.key;
      raw.push({
        id: e.id,
        origin: CANVAS_ORIGINS.rule,
        source: nodeId.rule(e.key),
        handle: e.key,
        target,
        otherwise: false,
        label,
      });
    }
  }
  if (declared !== undefined && stageKeys.has(declared.start)) {
    for (const entry of entries) {
      raw.push({
        id: `entry:${entry.key}`,
        origin: CANVAS_ORIGINS.entry,
        source: nodeId.entry(entry.key),
        handle: entry.key,
        target: nodeId.stage(declared.start),
        otherwise: false,
        label: entry.label,
      });
    }
  }
  const pair = (a: RawArrow): string => `${a.source}>${a.target}`;
  const total = new Map<string, number>();
  for (const a of raw) total.set(pair(a), (total.get(pair(a)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const arrows = raw.map((a): CanvasArrow => {
    const slot = seen.get(pair(a)) ?? 0;
    seen.set(pair(a), slot + 1);
    return { ...a, slot, slots: total.get(pair(a)) ?? 1, reversed: total.has(`${a.target}>${a.source}`) };
  });

  return {
    hasProcess: declared !== undefined,
    parents: parentLinks(links, type).map((l) => ({ type: l.parent, label: l.parentLabel })),
    ...(property !== undefined ? { property } : {}),
    ...(process !== undefined ? { process } : {}),
    stages,
    global: inStage(undefined),
    entries,
    rules,
    arrows,
  };
}
