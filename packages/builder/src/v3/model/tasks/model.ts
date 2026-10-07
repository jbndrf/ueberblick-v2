/**
 * The Aufgaben table as data (v3 `ModelOverviewView.svelte:48-62`: name, stage, mode, tools, target). One row per
 * task of the Objektart: its name, the Phase it is offered in, who may use it ("Wer darf dies nutzen"), how it starts,
 * how many form fields it has and the Phase it leads to. All of it read from the effective file by the readers the
 * task pane and the canvas use (R1); nothing is stored.
 */
import { listAutos, stepProperties, type LocalizedString, type TemplateFile } from '@ueberblick/core';
import type { Doc } from '../../../doc';
import { deriveProcesses, pinnedOptions } from '../../../lenses/process/graph';
import { labelOf } from '../../../shell/location';
import { buildInventory } from '../../catalog/inventory';

/** Where a task is offered, as v3's stage column: pinned Phasen, the map entry, every Phase, or no process. */
export const TASK_PHASES = { pinned: 'pinned', entry: 'entry', any: 'any', none: 'none' } as const;
export type TaskPhase = (typeof TASK_PHASES)[keyof typeof TASK_PHASES];

/** v3's activation mode: a person starts it, or a rule runs it (`automatic`). */
export const TASK_STARTS = { manual: 'manual', rule: 'rule' } as const;
export type TaskStart = (typeof TASK_STARTS)[keyof typeof TASK_STARTS];

export interface TaskRowModel {
  readonly key: string;
  readonly label: string;
  readonly phase: TaskPhase;
  /** For `pinned`: the labels of the Phasen. */
  readonly phases: readonly string[];
  /** The role labels of the task's `who`; empty: no person (automatic only). */
  readonly roles: readonly string[];
  readonly start: TaskStart;
  /** Form fields plus the properties of quick-edit and location steps (v3 "tools"). */
  readonly fields: number;
  /** The labels of the Phasen the task leads to. */
  readonly targets: readonly string[];
}

export function buildTaskRows(doc: Doc, type: string, locale: string): readonly TaskRowModel[] {
  const file: TemplateFile = doc.effective();
  const inventory = buildInventory(doc, type, locale);
  const process = deriveProcesses(file, type)[0];
  const optionLabel = (option: string): string => {
    const node = process?.nodes.find((n) => n.option === option);
    return labelOf(node?.label as LocalizedString | undefined, locale, option);
  };
  const runByRule = new Set(listAutos(file).map((a) => a.task));
  return inventory.tasks.map((row): TaskRowModel => {
    const task = file.tasks?.[row.key];
    const pins = process === undefined ? undefined : pinnedOptions(task?.when, process.property);
    const phase: TaskPhase =
      process === undefined
        ? TASK_PHASES.none
        : row.badge === 'entry'
          ? TASK_PHASES.entry
          : pins !== undefined
            ? TASK_PHASES.pinned
            : TASK_PHASES.any;
    const targets = [
      ...new Set(
        (process?.edges ?? []).filter((e) => e.origin === 'task' && e.key === row.key).map((e) => e.to),
      ),
    ];
    return {
      key: row.key,
      label: row.label,
      phase,
      phases: row.stages,
      roles: (task?.who ?? []).map((r) =>
        labelOf(file.roles?.[r]?.label as LocalizedString | undefined, locale, r),
      ),
      start: runByRule.has(row.key) || row.automatic ? TASK_STARTS.rule : TASK_STARTS.manual,
      fields: task === undefined ? 0 : Object.keys(task.form ?? {}).length + stepProperties(task).length,
      targets: targets.map(optionLabel),
    };
  });
}
