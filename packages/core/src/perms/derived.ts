/**
 * The rights a role has because of the tasks it may run (C-004 step 3, A-009's next step). A role may run a task when
 * its `who` names it; the task writes the properties of its form, its steps and its `then.set`. So a role's create,
 * write and delete rights on a type follow from its tasks. One derivation (R1): the builder's roles page and the
 * comparison with `permissions` read it. A write to the feature a task creates is never a "write right" (plan does not
 * check it either).
 */
import type { CompiledConfig } from '../schema/compile/contract';
import { taskTypes } from '../schema/compile/indexes';
import { kp } from '../schema/compile/kp';
import { stepProperties } from '../schema/steps-of';
import type { Task } from '../schema/task';
import { WHO_ADMIN } from './who';

type Roles = Set<string>;

export interface DerivedRights {
  /** Feature type to the roles that may create it (a task with `creates`). */
  readonly create: ReadonlyMap<string, ReadonlySet<string>>;
  /** Feature type to property to the roles that may change it on an existing feature. */
  readonly write: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>;
  /** Feature type to the roles that may delete it (a `lifecycle: deleted` step). */
  readonly delete: ReadonlyMap<string, ReadonlySet<string>>;
}

const add = (m: Map<string, Roles>, key: string, roles: readonly string[]): void => {
  const set = m.get(key) ?? new Set<string>();
  for (const r of roles) set.add(r);
  m.set(key, set);
};

/** The feature type a bound name or an `of` expression yields, from the compiled expression types. */
function typeOfExpression(config: CompiledConfig, path: string): string | undefined {
  const ty = config.expressions.get(path)?.typed.type;
  if (ty === undefined) return undefined;
  if (ty.kind === 'feature') return ty.type;
  return ty.kind === 'list' && ty.element.kind === 'feature' ? ty.element.type : undefined;
}

function taskWrites(
  config: CompiledConfig,
  key: string,
  task: Task,
): { own: string[]; elsewhere: { type: string; property: string }[]; deletes: string[] } {
  const own = [...Object.keys(task.form ?? {}).filter((k) => !k.includes('.')), ...stepProperties(task)];
  const elsewhere: { type: string; property: string }[] = [];
  const deletes: string[] = [];
  const subjectTypes = task.creates === undefined ? taskTypes(task) : [];
  for (const k of Object.keys(task.form ?? {}).filter((f) => f.includes('.'))) {
    const type = typeOfExpression(config, kp('tasks', key, 'bind', k.slice(0, k.indexOf('.'))));
    if (type !== undefined) elsewhere.push({ type, property: k.slice(k.indexOf('.') + 1) });
  }
  (task.then ?? []).forEach((step, i) => {
    const target =
      step.of === undefined ? undefined : typeOfExpression(config, kp('tasks', key, 'then', i, 'of'));
    if (step.lifecycle === 'deleted') deletes.push(...(target !== undefined ? [target] : subjectTypes));
    for (const k of Object.keys(step.set ?? {})) {
      if (k.includes('.')) {
        const type = typeOfExpression(config, kp('tasks', key, 'bind', k.slice(0, k.indexOf('.'))));
        if (type !== undefined) elsewhere.push({ type, property: k.slice(k.indexOf('.') + 1) });
      } else if (step.of !== undefined) {
        if (target !== undefined) elsewhere.push({ type: target, property: k });
      } else own.push(k);
    }
  });
  return { own, elsewhere, deletes };
}

export function deriveRights(config: CompiledConfig): DerivedRights {
  const create = new Map<string, Roles>();
  const del = new Map<string, Roles>();
  const writeFlat = new Map<string, Roles>();
  for (const [key, task] of Object.entries(config.file.tasks ?? {})) {
    const roles = (task.who ?? []).filter((r) => r !== WHO_ADMIN);
    if (roles.length === 0) continue;
    if (task.creates !== undefined) add(create, task.creates, roles);
    const w = taskWrites(config, key, task);
    // the created feature's own values are not a write right; on an existing feature they are
    if (task.creates === undefined)
      for (const type of taskTypes(task)) for (const p of w.own) add(writeFlat, `${type}\u0000${p}`, roles);
    for (const e of w.elsewhere) add(writeFlat, `${e.type}\u0000${e.property}`, roles);
    for (const type of w.deletes) add(del, type, roles);
  }
  const write = new Map<string, Map<string, Roles>>();
  for (const [k, roles] of writeFlat) {
    const [type = '', property = ''] = k.split('\u0000');
    const props = write.get(type) ?? new Map<string, Roles>();
    props.set(property, roles);
    write.set(type, props);
  }
  return { create, write, delete: del };
}
