// The CSS colour of a task button (v3 `button_color`): one helper for the participant action row and the builder's
// stage preview (R1).
import type { TaskButtonColor } from '@ueberblick/core/registry';

/** The CSS colour of a named button colour; `neutral` is the plain secondary button (v3 without `button_color`). */
const NAMED: Readonly<Record<TaskButtonColor, string | undefined>> = {
  primary: 'var(--primary)',
  success: '#16a34a',
  warning: '#d97706',
  danger: 'var(--destructive)',
  neutral: undefined,
};

/** A named colour, or a `#rrggbb` hex as given; undefined for the plain button. */
export function buttonColor(color: string | undefined): string | undefined {
  if (color === undefined) return undefined;
  return Object.hasOwn(NAMED, color) ? NAMED[color as TaskButtonColor] : color;
}
