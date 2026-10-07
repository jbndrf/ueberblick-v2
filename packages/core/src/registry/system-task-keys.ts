/**
 * The keys of the built-in system tasks, for callers that name them. Kept apart from the descriptive table
 * (`SYSTEM_TASKS`, subpath `registry/admin`) so the participant shell bundles only these short strings (WP-858).
 */
/** The key of the move task, for callers that name it (the deploy executor). */
export const MOVE_TASK = '$move';

/** The key of the seed task, for callers that name it (the preview seeder). */
export const SEED_TASK = '$seed';

/** The key of the recompute task, for callers that name it (the deploy executor). */
export const RECOMPUTE_TASK = '$recompute';

/** The key of the pin task, for callers that name it (the deploy). */
export const PIN_TASK = '$pin';

/** The key of the import task, for callers that name it (the import). */
export const IMPORT_TASK = '$import';

/** The key of the lifecycle task, for callers that name it (replace in the import). */
export const LIFECYCLE_TASK = '$lifecycle';

/** The key of the admin creation task, for callers that name it (the admin features endpoint). */
export const CREATE_TASK = '$create';

/** The key of the admin correction task, for callers that name it (the admin data page's endpoint). */
export const CORRECT_TASK = '$correct';

export const SYSTEM_TASK_KEYS = [
  MOVE_TASK,
  SEED_TASK,
  RECOMPUTE_TASK,
  PIN_TASK,
  IMPORT_TASK,
  LIFECYCLE_TASK,
  CREATE_TASK,
  CORRECT_TASK,
] as const;
export type SystemTask = (typeof SYSTEM_TASK_KEYS)[number];
