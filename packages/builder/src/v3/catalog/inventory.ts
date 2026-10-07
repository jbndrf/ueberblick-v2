/**
 * The catalog's inventories (v3 `CatalogSidebar.svelte:131-166`): the Objektart's tasks, rules and
 * fields, as data. A pure view over the effective file (docs/08); nothing is stored.
 */
import {
  TASK_OFFERS,
  autoPath,
  listAutos,
  processesOf,
  type AutoTimingKind,
  type Task,
} from '@ueberblick/core';
import type { Doc } from '../../doc';
import { pinnedOptions, taskOfferedOn } from '../../lenses/process/graph';
import { buildRules, triggerOf } from '../../lenses/rules/model';
import { autoAt, isSystemOnly, ownedTasks } from '../rule/auto-task';
import { labelOf } from '../../shell/location';

/** Why a task row carries a badge. */
export const TASK_BADGES = { entry: 'entry', many: 'many', stage: 'stage' } as const;
export type TaskBadge = (typeof TASK_BADGES)[keyof typeof TASK_BADGES];

export interface TaskRow {
  readonly key: string;
  readonly path: string;
  readonly label: string;
  /** `entry`: creates this type from the map; `many`: offered on several types; `stage`: pinned to stages. */
  readonly badge?: TaskBadge;
  /** For `stage`: the labels of the stages the task is pinned to. */
  readonly stages: readonly string[];
  /** Only the system runs it and no single rule owns it (C-004): listed under "Automatisch". */
  readonly automatic: boolean;
}

export interface RuleRow {
  readonly key: string;
  readonly path: string;
  readonly label: string;
  readonly trigger: AutoTimingKind;
}

export interface FieldRow {
  readonly key: string;
  readonly path: string;
  readonly label: string;
}

export interface Inventory {
  readonly tasks: readonly TaskRow[];
  readonly rules: readonly RuleRow[];
  readonly fields: readonly FieldRow[];
  /**
   * Template elements the project hides (`hide` in the overlay), at the end of each list, greyed with "Einblenden".
   * Empty for a project without a template. Same row shapes; the path is what `unhide` takes.
   */
  readonly hiddenTasks: readonly TaskRow[];
  readonly hiddenRules: readonly RuleRow[];
  readonly hiddenFields: readonly FieldRow[];
  /** The type declares a process, so a stage can be added. */
  readonly hasProcess: boolean;
}

export function buildInventory(doc: Doc, type: string, locale: string): Inventory {
  const file = doc.effective();
  const featureType = file.types?.[type];
  const process = featureType === undefined ? undefined : processesOf(featureType)[0];
  const stageLabel = (option: string): string =>
    labelOf(
      process === undefined ? undefined : featureType?.properties[process.property]?.options?.[option],
      locale,
      option,
    );
  // A rule's own task is its outcome, not an action of its own (C-004 step 1).
  const owned = ownedTasks(file);
  const ownedInTemplate = ownedTasks(doc.template);
  const taskRowOf = (key: string, task: Task): TaskRow | undefined => {
    const entry = task.on === '$map' && task.creates === type;
    if (!entry && !taskOfferedOn(task, type)) return undefined;
    const pins = process === undefined || entry ? undefined : pinnedOptions(task.when, process.property);
    const many =
      Array.isArray(task.on) && task.on.filter((o) => !TASK_OFFERS.keys.includes(o as never)).length > 1;
    const badge = entry
      ? TASK_BADGES.entry
      : many
        ? TASK_BADGES.many
        : pins !== undefined
          ? TASK_BADGES.stage
          : undefined;
    return {
      key,
      path: `tasks.${key}`,
      label: labelOf(task.label, locale, key),
      ...(badge === undefined ? {} : { badge }),
      stages: pins?.map(stageLabel) ?? [],
      automatic: isSystemOnly(task) && !owned.has(key),
    };
  };
  const offered = Object.entries(file.tasks ?? {}).flatMap(([k, t]) => taskRowOf(k, t) ?? []);
  const tasks = offered.filter((r) => !owned.has(r.key));
  const taskKeys = new Set(offered.map((t) => t.key));
  const rules = buildRules(doc, locale)
    .filter((r) => taskKeys.has(r.run))
    .map((r): RuleRow => ({ key: r.key, path: autoAt(r.key), label: r.label, trigger: r.trigger.kind }));
  const fields = Object.entries(featureType?.properties ?? {}).map(([key, p]): FieldRow => ({
    key,
    path: `types.${type}.properties.${key}`,
    label: labelOf(p.label, locale, key),
  }));
  const hidden = new Set(doc.overlay().hide ?? []);
  const hiddenTasks =
    hidden.size === 0
      ? []
      : Object.entries(doc.template.tasks ?? {}).flatMap(([k, t]) =>
          hidden.has(`tasks.${k}`) ? (taskRowOf(k, t) ?? []) : [],
        );
  const hiddenTasksShown = hiddenTasks.filter((t) => !ownedInTemplate.has(t.key));
  // An action the project hides on its own; an action that leaves with its hidden task is listed with the task.
  const hiddenRules = listAutos(doc.template)
    .filter((a) => hidden.has(autoPath(a)) && taskKeys.has(a.task))
    .map((a): RuleRow => ({
      key: a.id,
      path: autoPath(a),
      label: labelOf(a.entry.label, locale, a.name),
      trigger: triggerOf(a.entry).kind,
    }));
  const hiddenFields = Object.entries(doc.template.types?.[type]?.properties ?? {})
    .filter(([k]) => hidden.has(`types.${type}.properties.${k}`))
    .map(([k, p]): FieldRow => ({
      key: k,
      path: `types.${type}.properties.${k}`,
      label: labelOf(p.label, locale, k),
    }));
  return {
    tasks,
    rules,
    fields,
    hiddenTasks: hiddenTasksShown,
    hiddenRules,
    hiddenFields,
    hasProcess: process !== undefined,
  };
}
