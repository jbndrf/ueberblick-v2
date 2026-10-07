import { defineRegistry, type KeyOf } from './define';

/**
 * The kinds of `then` step (docs/05). A step is written with exactly one kind's key (`set: {...}`, `redact: {...}`);
 * further effects join here, not as new special cases in plan.
 */
export const THEN_STEP_KINDS = defineRegistry([
  {
    key: 'set',
    description:
      'Writes values to properties of the task subject, of a bound feature, or (with `of`) of each feature `of` names.',
  },
  {
    key: 'redact',
    description:
      'Erases the personal values of a subject (B-005): appends null observations and lists the pairs the server purges in place.',
  },
  {
    key: 'lifecycle',
    description:
      'Sets the system lifecycle of the task subject, or (with `of`) of each feature `of` names (active, completed, archived, deleted): writes `$lifecycle`.',
  },
] as const);
export type ThenStepKind = KeyOf<typeof THEN_STEP_KINDS>;
