/**
 * Lookups derived from the effective file. Shared by compile() and hydrate(), so it may not import
 * Zod or the expression checker (the participant shell hydrates without them, A-005).
 */
import { TASK_OFFERS } from '../../registry';
import type { TemplateFile } from '../file';
import { listAutos, triggerOf, type Auto, type AutoId } from './autos';
import type { CompiledConfig } from './contract';

type TaskLike = { readonly on: string | readonly string[] };

/** Keys of the feature types a task is offered on; empty for `map` and `none`. */
export function taskTypes(task: TaskLike): readonly string[] {
  if (typeof task.on !== 'string') return task.on;
  return (TASK_OFFERS.keys as readonly string[]).includes(task.on) ? [] : [task.on];
}

/** `tasksByType` (including `map` and `none` offers) and the table of automatic actions with its trigger index (C-004). */
export function buildIndexes(
  file: TemplateFile,
): Pick<CompiledConfig, 'tasksByType' | 'autos' | 'autosByTrigger'> {
  const tasksByType = new Map<string, string[]>();
  for (const [key, task] of Object.entries(file.tasks ?? {})) {
    const types = taskTypes(task);
    for (const t of types.length > 0 ? types : [task.on as string]) {
      tasksByType.set(t, [...(tasksByType.get(t) ?? []), key]);
    }
  }
  const autos = new Map<AutoId, Auto>();
  const autosByTrigger = new Map<string, string[]>();
  for (const a of listAutos(file)) {
    autos.set(a.id, a);
    const trigger = triggerOf(a);
    autosByTrigger.set(trigger, [...(autosByTrigger.get(trigger) ?? []), a.id]);
  }
  return { tasksByType, autos, autosByTrigger };
}
