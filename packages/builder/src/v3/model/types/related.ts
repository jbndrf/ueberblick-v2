/**
 * What belongs to one Objektart in the project file (WP-419, S3-19): its tasks (with their automatic actions) and its
 * views. v3 hung these on the workflow record (stages, rules, forms); here they are keyed entries that name the type, so
 * "the type and what belongs to it" is one reading of the file that duplicate, import and delete share (R1).
 */
import { listAutos, type TemplateFile } from '@ueberblick/core';

type Tasks = NonNullable<TemplateFile['tasks']>;
type Task = Tasks[string];
type Views = NonNullable<TemplateFile['views']>;

/** The type keys a task is offered on (`$map` and `$none` are not types). */
export function taskTypes(task: Task): readonly string[] {
  return (typeof task.on === 'string' ? [task.on] : task.on).filter((k) => !k.startsWith('$'));
}

/** A task belongs to a type when it is offered on it or creates it. */
export const taskOf = (task: Task, type: string): boolean =>
  task.creates === type || taskTypes(task).includes(type);

export interface Related {
  readonly tasks: readonly string[];
  /** Auto ids (`<task>.<name>`) of a task of the type, or that run `after` one. */
  readonly rules: readonly string[];
  readonly views: readonly string[];
}

export const viewOf = (view: Views[string], type: string): boolean => view.source.type === type;

/** Keys of everything that names `type`; nothing is invented, the order is the file's. */
export function relatedTo(file: TemplateFile, type: string): Related {
  const tasks = Object.entries(file.tasks ?? {})
    .filter(([, t]) => taskOf(t, type))
    .map(([k]) => k);
  const own = new Set(tasks);
  const rules = listAutos(file)
    .filter((a) => own.has(a.task) || own.has(a.entry.after ?? ''))
    .map((a) => a.id);
  const views = Object.entries(file.views ?? {})
    .filter(([, v]) => viewOf(v, type))
    .map(([k]) => k);
  return { tasks, rules, views };
}

/** What the delete dialog counts from the file: stages (options of the process property), tasks, rules and views. */
export interface Footprint {
  readonly stages: number;
  readonly tasks: number;
  readonly rules: number;
  readonly views: number;
}

export function footprint(file: TemplateFile, type: string): Footprint {
  const def = file.types?.[type];
  const stageKey = def?.process?.property;
  const stages = stageKey === undefined ? 0 : Object.keys(def?.properties[stageKey]?.options ?? {}).length;
  const r = relatedTo(file, type);
  return { stages, tasks: r.tasks.length, rules: r.rules.length, views: r.views.length };
}
