/**
 * Where a property is used (the "used-in" of the Felder hub): the tasks of the Objektart whose form or steps write it,
 * and the automatic actions that read it. A pure function of the effective file; nothing is stored (WP-378). The parser is core's
 * (R5): a rule reads `self.<property>` when its condition mentions it.
 */
import { listAutos, stepProperties, type TemplateFile } from '@ueberblick/core';
import { children, parse, type Expr } from '@ueberblick/core/expr/compile';
import { taskChanges, taskOfferedOn } from '../../../lenses/process/graph';

export interface UsedIn {
  /** Task keys that write the property: form field, quick-edit or location step, or a `then` step. */
  readonly tasks: readonly string[];
  /** Auto ids (`<task>.<name>`) that read it: timing "property changed", or `self.<property>` in the condition. */
  readonly rules: readonly string[];
}

/** True when `src` reads `self.<property>`. A condition that does not parse reads nothing. */
export function readsSelf(src: string | undefined, property: string): boolean {
  if (src === undefined) return false;
  const parsed = parse(src);
  if (!parsed.ok) return false;
  const stack: Expr[] = [parsed.ast];
  while (stack.length > 0) {
    const e = stack.pop() as Expr;
    if (e.kind === 'member' && e.field === property && e.object.kind === 'ident' && e.object.name === 'self')
      return true;
    stack.push(...children(e));
  }
  return false;
}

type Task = NonNullable<TemplateFile['tasks']>[string];

function writes(task: Task, property: string): boolean {
  if (task.form !== undefined && property in task.form) return true;
  if (stepProperties(task).includes(property)) return true;
  return (task.then ?? []).some((s) => s.set !== undefined && property in s.set);
}

/** Does a task act on features of `type`: it creates one, or it is offered on one. */
const actsOn = (task: Task, type: string): boolean => taskChanges(task, type) || taskOfferedOn(task, type);

export function usedIn(file: TemplateFile, type: string, property: string): UsedIn {
  const tasks = Object.entries(file.tasks ?? {})
    .filter(([, t]) => taskChanges(t, type) && writes(t, property))
    .map(([key]) => key);
  const rules = listAutos(file)
    .filter(({ entry }) => {
      if (entry.change === `${type}.${property}`) return true;
      const after = entry.after === undefined ? undefined : file.tasks?.[entry.after];
      const own = entry.change?.split('.')[0] === type || (after !== undefined && actsOn(after, type));
      return own && readsSelf(entry.when, property);
    })
    .map((a) => a.id);
  return { tasks, rules };
}
