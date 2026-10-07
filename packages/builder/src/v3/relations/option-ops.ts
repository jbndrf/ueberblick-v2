/**
 * The ops that write a relation's options (WP-371, owner A2; the shapes are in `options.ts`). Each function reads the
 * Doc it is given and returns ops for it, so saving the same option twice returns no op and a changed option rewrites
 * the entries it wrote before. Headless; the relation ops compose them into one edit.
 */
import { AUDIENCES, type TemplateFile } from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { clearOps, setOps, setWhenOps } from '../../lenses/task/edit';
import { setThenOps } from '../task/outcome-ops';
import {
  cascadeStep,
  createTaskKey,
  createTaskLabel,
  deleteTaskKey,
  deleteTasksOf,
  DELETE_TASK_LABEL,
  detachStep,
  isCreateTaskOf,
  isOptionStep,
  withBlock,
  withoutBlock,
  type OnDeleteBehavior,
  type RelationAttachment,
  type RelationOptions,
  type RelationRef,
  type TaskDef,
  type ThenStep,
} from './options';

/**
 * The `who` of a task the options add (C-004 step 3): the roles that hold `action` on `type` today, so the task is run by
 * the same people as before the rights followed from `who`. None: no `who` (only an admin's `$create` reaches the type).
 */
function whoOf(file: TemplateFile, type: string, action: 'create' | 'delete'): { who?: string[] } {
  const audience = file.types?.[type]?.permissions?.[action];
  const roles = Object.keys(file.roles ?? {});
  const who =
    audience === AUDIENCES.keys[0]
      ? roles
      : Array.isArray(audience)
        ? audience.filter((r) => roles.includes(r))
        : [];
  return who.length === 0 ? {} : { who };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** `then` of a task; a value that is the template's own again drops the override instead of repeating it. */
function thenOps(doc: Doc, task: string, next: readonly ThenStep[]): readonly Op[] {
  const path = `tasks.${task}.then`;
  return doc.provenance(path) === 'changed' && same(next, doc.template.tasks?.[task]?.then)
    ? [{ kind: 'reset', path }]
    : setThenOps(doc, task, next);
}

/** `when` of a task (`undefined`: none), likewise. */
function whenOps(doc: Doc, task: string, when: string | undefined): readonly Op[] {
  const path = `tasks.${task}.when`;
  return doc.provenance(path) === 'changed' && when === doc.template.tasks?.[task]?.when
    ? [{ kind: 'reset', path }]
    : setWhenOps(doc, task, when ?? '');
}

/** Anbindung: the child's creating task (once), and `required` on the child's reference for "Verbindlich". */
export function attachmentOps(
  doc: Doc,
  r: RelationRef,
  attachment: RelationAttachment,
  name: string,
): readonly Op[] {
  const file = doc.effective();
  const ops: Op[] = [];
  const key = createTaskKey(r);
  // A task already under the key is adopted only when it is this relation's own (`clashOf` refuses the rest).
  if (file.tasks?.[key] === undefined) {
    ops.push({
      kind: 'add',
      path: `tasks.${key}`,
      value: {
        label: createTaskLabel(name),
        on: r.parent,
        ...whoOf(file, r.child, 'create'),
        creates: r.child,
        then: [{ set: { [r.refKey]: 'self' } }],
      },
    });
  }
  const reference = file.types?.[r.child]?.properties[r.refKey];
  const required = attachment === 'enforced';
  if (reference !== undefined && (reference.required === true) !== required)
    ops.push(...setOps(doc, `types.${r.child}.properties.${r.refKey}.required`, required));
  return ops;
}

/** The relation's own steps for `behavior`, in front of the others (they must run before the parent's own delete). */
function stepsFor(r: RelationRef, behavior: OnDeleteBehavior): readonly ThenStep[] {
  return behavior === 'cascade' ? [cascadeStep(r)] : behavior === 'nullify' ? [detachStep(r)] : [];
}

/** A key for the task the options add to a parent that has no delete task. */
function freshDeleteKey(doc: Doc, parent: string): string {
  const taken = doc.effective().tasks ?? {};
  const base = deleteTaskKey(parent);
  let key = base;
  for (let n = 2; taken[key] !== undefined; n++) key = `${base}_${n}`;
  return key;
}

/**
 * "Wenn das Eltern-Element gelöscht wird": into every delete task of the parent, the relation's steps (replacing the
 * ones of an earlier choice) and, for blockieren, its operand in `when`. A parent with no delete task gets one only
 * for mitlöschen and blockieren: with trennen there is nothing to detach from, as nothing can be deleted.
 */
export function onDeleteOps(doc: Doc, r: RelationRef, behavior: OnDeleteBehavior): readonly Op[] {
  const file = doc.effective();
  const deletes = deleteTasksOf(file, r.parent);
  if (deletes.length === 0) {
    if (behavior === 'nullify') return [];
    return [
      {
        kind: 'add',
        path: `tasks.${freshDeleteKey(doc, r.parent)}`,
        value: {
          label: DELETE_TASK_LABEL,
          on: r.parent,
          ...whoOf(file, r.parent, 'delete'),
          ...(behavior === 'block' ? { when: withBlock(undefined, r) } : {}),
          then: [...stepsFor(r, behavior), { lifecycle: 'deleted' }],
        },
      },
    ];
  }
  const ops: Op[] = [];
  for (const { key, task } of deletes) {
    const then = task.then ?? [];
    const next = [...stepsFor(r, behavior), ...then.filter((s) => !isOptionStep(s, r))];
    if (!same(next, then)) ops.push(...thenOps(doc, key, next));
    const when = behavior === 'block' ? withBlock(task.when, r) : withoutBlock(task.when, r);
    if (when !== task.when) ops.push(...whenOps(doc, key, when));
  }
  return ops;
}

/** Both options (a new relation). */
export const optionOps = (doc: Doc, r: RelationRef, o: RelationOptions, name: string): readonly Op[] => [
  ...attachmentOps(doc, r, o.attachment, name),
  ...onDeleteOps(doc, r, o.onDelete),
];

function isGeneratedDeleteTask(doc: Doc, key: string, task: TaskDef, parent: string): boolean {
  return (
    (key === deleteTaskKey(parent) || new RegExp(`^${deleteTaskKey(parent)}_\\d+$`).test(key)) &&
    doc.provenance(`tasks.${key}`) === 'added' &&
    task.on === parent &&
    same(task.label, DELETE_TASK_LABEL)
  );
}

/** Takes everything the options wrote for the relation out of the file (the relation is deleted or moves). */
export function clearOptionOps(doc: Doc, r: RelationRef): readonly Op[] {
  const file = doc.effective();
  const ops: Op[] = [];
  const key = createTaskKey(r);
  const created = file.tasks?.[key];
  if (created !== undefined && isCreateTaskOf(created, r)) ops.push(...clearOps(doc, `tasks.${key}`));
  for (const { key: k, task } of deleteTasksOf(file, r.parent)) {
    const then = (task.then ?? []).filter((s) => !isOptionStep(s, r));
    const when = withoutBlock(task.when, r);
    // The delete task the options added (nothing else on it, never edited): it goes when its last option goes.
    const bare = then.length === 1 && same(then[0], { lifecycle: 'deleted' }) && when === undefined;
    if (bare && isGeneratedDeleteTask(doc, k, task, r.parent)) {
      ops.push(...clearOps(doc, `tasks.${k}`));
      continue;
    }
    if (then.length !== (task.then ?? []).length) ops.push(...thenOps(doc, k, then));
    if (when !== task.when) ops.push(...whenOps(doc, k, when));
  }
  return ops;
}

/** True when the key of the relation's creating task holds a task that is not its own (an author's task). */
export function clashOf(doc: Doc, r: RelationRef): boolean {
  const task = doc.effective().tasks?.[createTaskKey(r)];
  return task !== undefined && !isCreateTaskOf(task, r);
}

/** A relation renamed: the creating task keeps its generated label in step, unless the admin changed it. */
export function renameOps(doc: Doc, r: RelationRef, from: string, to: string): readonly Op[] {
  const key = createTaskKey(r);
  const label = doc.effective().tasks?.[key]?.label;
  return label !== undefined && same(label, createTaskLabel(from))
    ? [{ kind: 'set', path: `tasks.${key}.label`, value: createTaskLabel(to) }]
    : [];
}
