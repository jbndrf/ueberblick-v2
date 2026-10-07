/**
 * Who may run a task (C-004 step 3): the task's `who` lists role keys plus the reserved `admin` and `import`. The one
 * check, shared by plan's scope (refusal) and every UI that lists tasks (R1). No `who` means no person may run the task.
 */
import type { Actor } from '../model';
import type { TaskWhoReserved } from '../registry';

/** The reserved `who` entry that admits an admin account (registry TASK_WHO_RESERVED). */
export const WHO_ADMIN: TaskWhoReserved = 'admin';
/** The reserved `who` entry that names the import actor. */
export const WHO_IMPORT: TaskWhoReserved = 'import';

/** What the check reads of a task. */
export interface TaskWho {
  readonly who?: readonly string[] | undefined;
  readonly auto?: object | undefined;
}

/**
 * May this actor run the task?
 * - A participant needs a role listed in `who`. An admin account too, or `admin` itself (it may hold roles in the project, `Auth.rolesFor`).
 * - The system skips `who` only for the run of one of this task's own `auto` entries (`ownAuto`: the caller checked that
 *   the run's `auto` names an entry of this task). Any other system run of a task is refused here.
 * - An import needs `import` in `who` or a role it holds that is in `who` (the admin's import holds every role of the
 *   project). A task without `who` refuses it, like a person.
 */
export function whoAdmits(task: TaskWho, actor: Actor, ownAuto = false): boolean {
  const who = task.who;
  switch (actor.kind) {
    case 'participant':
      return who !== undefined && actor.roles.some((r) => who.includes(r));
    case 'admin':
      return who !== undefined && (who.includes(WHO_ADMIN) || actor.roles.some((r) => who.includes(r)));
    case 'system':
      return ownAuto && task.auto !== undefined && Object.keys(task.auto).length > 0;
    case 'import':
      return who !== undefined && (who.includes(WHO_IMPORT) || actor.roles.some((r) => who.includes(r)));
    default: {
      const unhandled: never = actor.kind;
      return unhandled;
    }
  }
}

/**
 * For tests and fixtures only: gives every task that names no `who` all roles of the file plus `admin` and `import`, so a hand-made
 * file's tasks can be run by people (without `who` nobody may). Returns the same object, mutated.
 */
export function everyone<F>(file: F): F {
  const f = file as unknown as {
    roles?: Record<string, unknown>;
    tasks?: Record<string, { who?: string[] }>;
  };
  const who = [...Object.keys(f.roles ?? {}), WHO_ADMIN, WHO_IMPORT];
  for (const task of Object.values(f.tasks ?? {})) if (task.who === undefined) task.who = who;
  return file;
}

/** The `who` of a new person action (owner 2026-10-05, like v3's empty role list): every role key of the file plus `admin`. */
export function allRolesWho(file: {
  readonly roles?: Readonly<Record<string, unknown>> | undefined;
}): string[] {
  return [...Object.keys(file.roles ?? {}), WHO_ADMIN];
}
