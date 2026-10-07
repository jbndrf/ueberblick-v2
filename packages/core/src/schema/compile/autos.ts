/**
 * The compiled table of automatic actions (C-004): every `tasks.<task>.auto.<name>` entry of the effective file, with its
 * timing resolved. The one reader of the `auto` maps: plan, timers, deploy, the builder and the compile checks read
 * this, never the raw maps (R1). Shared by compile() and hydrate(), so it may not import Zod.
 */
import type { AutoTimingKind } from '../../registry';
import type { KeyPath } from '../../template/contract';
import type { AutoEntry } from '../auto';
import type { TemplateFile } from '../file';
import { kp } from './kp';

/** The identity of an automatic action: the pair (task, name), written `<task>.<name>`. Keys have no dots. */
export type AutoId = string;

export const autoId = (task: string, name: string): AutoId => `${task}.${name}`;

/** Splits an `AutoId`. */
export function splitAutoId(id: AutoId): { task: string; name: string } {
  const at = id.indexOf('.');
  return { task: id.slice(0, at), name: id.slice(at + 1) };
}

export interface Auto {
  readonly id: AutoId;
  /** The task the system runs. */
  readonly task: string;
  readonly name: string;
  readonly entry: AutoEntry;
  readonly kind: AutoTimingKind;
}

/** The timing of an entry: its one timing key, else `edge` (the entry `when` turning true). */
export function timingOf(entry: AutoEntry): AutoTimingKind {
  if (entry.after !== undefined) return 'after';
  if (entry.change !== undefined) return 'change';
  if (entry.elapsed !== undefined) return 'elapsed';
  if (entry.schedule !== undefined) return 'schedule';
  return 'edge';
}

/** The `autosByTrigger` key of an entry: `task.<k>`, `<type>.<property>`, `when`, `elapsed` or `schedule`. */
export function triggerOf(a: Pick<Auto, 'kind' | 'entry'>): string {
  switch (a.kind) {
    case 'after':
      return `task.${a.entry.after as string}`;
    case 'change':
      return a.entry.change as string;
    case 'edge':
      return 'when';
    default:
      return a.kind;
  }
}

/** The key path of a field of an automatic action, `tasks.<task>.auto.<name>.<rest>`. */
export const autoPath = (a: Pick<Auto, 'task' | 'name'>, ...rest: readonly string[]): KeyPath =>
  kp('tasks', a.task, 'auto', a.name, ...rest);

/** Every automatic action of `file`, in file order. */
export function listAutos(file: TemplateFile): Auto[] {
  const out: Auto[] = [];
  for (const [task, def] of Object.entries(file.tasks ?? {})) {
    for (const [name, entry] of Object.entries(def.auto ?? {})) {
      out.push({ id: autoId(task, name), task, name, entry, kind: timingOf(entry) });
    }
  }
  return out;
}
