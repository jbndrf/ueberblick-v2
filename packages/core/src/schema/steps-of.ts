// The pure step helpers. Apart from the schemas (task-steps.ts) so that participant code reading steps never
// pulls zod into its bundle (WP-975).
import type { TaskStep } from './task-steps';

interface StepsOf {
  readonly steps?: readonly TaskStep[] | undefined;
  readonly form?: object | undefined;
}

const FORM_STEP: TaskStep = { kind: 'form' };

/** The steps a task runs, in order: its `steps`, else just its form (if it has one). */
export function stepsOf(task: StepsOf): readonly TaskStep[] {
  return task.steps ?? (task.form === undefined ? [] : [FORM_STEP]);
}

/** Property keys the quick-edit and location steps write (the form's own keys are `form`'s). */
export function stepProperties(task: StepsOf): readonly string[] {
  return stepsOf(task).flatMap((s) =>
    s.kind === 'quick_edit' ? s.properties : s.kind === 'location' ? [s.property] : [],
  );
}
