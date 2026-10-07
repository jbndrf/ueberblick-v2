import { defineRegistry, type KeyOf } from './define';

/** Permission actions per feature type (decision 0012). */
export const PERM_ACTIONS = defineRegistry([
  { key: 'see', description: 'Read a feature (row) and its visible properties.' },
  { key: 'create', description: 'Create a feature of the type.' },
  { key: 'write', description: 'Change a property.' },
  { key: 'delete', description: 'Delete a feature.' },
] as const);
export type PermAction = KeyOf<typeof PERM_ACTIONS>;

/**
 * Kinds of permission subjects an actor carries. Today only roles; teams (O12, H2) join here
 * without changing the compiled shape. A subject is written `<kind>:<key>`.
 */
export const PERM_SUBJECT_KINDS = defineRegistry([
  { key: 'role', description: 'A role key of the project (actor.roles).' },
] as const);
export type PermSubjectKind = KeyOf<typeof PERM_SUBJECT_KINDS>;

/** Why a permission check denied (used by plan to build a refusal). */
export const PERM_DENIALS = defineRegistry([
  { key: 'type_unknown', description: 'The feature type does not exist in the compiled config.' },
  { key: 'not_visible', description: 'The actor may not see the feature (audience or visible_when).' },
  {
    key: 'subject_invalid',
    description:
      'A subject is not `<kind>:<key>` of a known PERM_SUBJECT_KINDS kind (a programming error of the caller, never a config state).',
  },
  { key: 'create_denied', description: 'The actor may not create features of the type.' },
  { key: 'write_denied', description: 'The actor may not write one of the properties.' },
  { key: 'delete_denied', description: 'The actor may not delete the feature.' },
] as const);
export type PermDenial = KeyOf<typeof PERM_DENIALS>;

/**
 * The reserved entries of a task's `who` that are no role of the project (C-004 step 3). `admin` lets an admin
 * account run the task (A-008), `import` the import (WP-301); a role of the same name is admitted as well.
 */
export const TASK_WHO_RESERVED = defineRegistry([
  { key: 'admin', description: 'An admin account (actor kind admin) may run the task.' },
  { key: 'import', description: 'The import (actor kind import) may run the task.' },
] as const);
export type TaskWhoReserved = KeyOf<typeof TASK_WHO_RESERVED>;
