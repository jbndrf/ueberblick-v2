/**
 * The task an automatic action owns. v3's automatic action was one entity with its own steps; in v4 an automatic action
 * is an `auto` entry of the task it runs (`tasks.<task>.auto.<name>`, C-004), so "Aktion hinzufügen → Automatisch"
 * makes a task together with its one entry: offered on the type, with no `who`, so only the system runs it. The action
 * pane edits its `then` steps.
 */
import { listAutos, splitAutoId, timingOf, type Auto, type TemplateFile } from '@ueberblick/core';
import { labelOf } from '../../shell/location';

type TaskDef = NonNullable<TemplateFile['tasks']>[string];

/** A task with automatic actions and no `who`: no person may run it (C-004 step 3). */
export const isSystemOnly = (task: TaskDef | undefined): boolean =>
  task !== undefined && (task.who ?? []).length === 0 && Object.keys(task.auto ?? {}).length > 0;

/** The automatic action `id` (`<task>.<name>`) of the file, or undefined when the file has none. */
export function autoOf(file: TemplateFile, id: string): Auto | undefined {
  if (!id.includes('.')) return undefined;
  const { task, name } = splitAutoId(id);
  const entry = file.tasks?.[task]?.auto?.[name];
  return entry === undefined ? undefined : { id, task, name, entry, kind: timingOf(entry) };
}

/** The key path of the automatic action `id`: `tasks.<task>.auto.<name>`. */
export function autoAt(id: string): string {
  const { task, name } = splitAutoId(id);
  return `tasks.${task}.auto.${name}`;
}

/** The name of the automatic action `id` in `locale`: its label, else its name. */
export function autoLabel(file: TemplateFile, id: string, locale: string): string {
  const auto = autoOf(file, id);
  return labelOf(auto?.entry.label, locale, auto?.name ?? id);
}

/** The ids of the automatic actions of `task`. */
export const rulesRunning = (file: TemplateFile, task: string): readonly string[] =>
  Object.keys(file.tasks?.[task]?.auto ?? {}).map((name) => `${task}.${name}`);

/** True when the action's task is its own: system-only and carrying this one entry alone. */
export function ownsTask(file: TemplateFile, id: string): boolean {
  const auto = autoOf(file, id);
  if (auto === undefined || !isSystemOnly(file.tasks?.[auto.task])) return false;
  return rulesRunning(file, auto.task).length === 1;
}

/** The tasks some action owns (C-004 step 1: an automatic action shows its own task as its outcome, never as a button). */
export function ownedTasks(file: TemplateFile): ReadonlySet<string> {
  const owned = new Set<string>();
  for (const a of listAutos(file)) if (ownsTask(file, a.id)) owned.add(a.task);
  return owned;
}

/** A system-only task no single action owns (several entries, or none): it keeps its entry, drawn with the automatic mark. */
export const isAutomaticOnly = (file: TemplateFile, key: string): boolean =>
  isSystemOnly(file.tasks?.[key]) && !ownedTasks(file).has(key);
