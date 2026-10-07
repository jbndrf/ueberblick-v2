/**
 * How a task shows in the action row (WP-616 `button`, `confirm`; v3 `visual.button_label` / `button_color`, detail module
 * :334-343). The model of the feature sheet carries key and label; the label of the button, its colour, its icon and the
 * confirmation come from the project file, so they are laid over it here.
 */
import { stepsOf } from '@ueberblick/core/form';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { Key } from '@ueberblick/core/model';
import { buttonColor, resolveLabel, type TaskChoice } from '@ueberblick/ui';
import type { Locale } from '../messages';

/** A task of the action row as drawn. */
export interface PresentedTask extends TaskChoice {
  /** An icon key; the row draws it when it knows it. */
  readonly icon?: string;
  /** Asked on the tap, before the task starts: only for a task without several steps (`confirmTiming`). */
  readonly confirm?: string;
}

/** The row while a quick edit is open (v3 detail module :1226-1250): Abbrechen and Speichern instead of the tasks. */
export interface EditActions {
  readonly saving: boolean;
  readonly oncancel: () => void;
  readonly onsave: () => void;
}

/**
 * When a task asks its `confirm` (WP-730, B-023; v3 never asked, the field is the owner's). A task with several steps
 * asks when the last step is sent ("Absenden"), because the question is about what is saved; any other task has no
 * "later" than its tap, so it asks there. This function is the one place of the timing: `presentTasks` and the steps
 * host read it.
 */
export function confirmTiming(file: CompiledConfig['file'], key: Key): 'tap' | 'submit' {
  const def = file.tasks?.[key];
  if (def === undefined) return 'tap';
  const hasForm = Object.keys(def.form ?? {}).length > 0;
  const steps = stepsOf(def).filter((s) => s.kind !== 'form' || hasForm);
  return steps.length > 1 ? 'submit' : 'tap';
}

/** The text the steps host asks at the submit; undefined when the task has none or asks on the tap. */
export function submitConfirm(file: CompiledConfig['file'], key: Key, locale: Locale): string | undefined {
  const def = file.tasks?.[key];
  if (def?.confirm === undefined || confirmTiming(file, key) !== 'submit') return undefined;
  const text = resolveLabel(def.confirm, locale, '');
  return text === '' ? undefined : text;
}

export function presentTasks(
  tasks: readonly TaskChoice[],
  file: CompiledConfig['file'],
  locale: Locale,
): PresentedTask[] {
  return tasks.map((choice) => {
    const def = file.tasks?.[choice.key as Key];
    const label =
      def?.button?.label === undefined ? choice.label : resolveLabel(def.button.label, locale, choice.label);
    const color = buttonColor(def?.button?.color);
    const confirm =
      def?.confirm === undefined || confirmTiming(file, choice.key) !== 'tap'
        ? undefined
        : resolveLabel(def.confirm, locale, '');
    return {
      key: choice.key,
      label,
      ...(color === undefined ? {} : { color }),
      ...(def?.button?.icon === undefined ? {} : { icon: def.button.icon }),
      ...(confirm === undefined || confirm === '' ? {} : { confirm }),
    };
  });
}
