// Shared by the field chrome and the inputs: the ids that tie help text and error to a control (aria-describedby).
export const hintId = (id: string): string => `${id}-hint`;
export const errorId = (id: string): string => `${id}-error`;

/** The value of `aria-describedby` for a control, or `undefined` when nothing describes it. */
export function describedBy(id: string, hasHint: boolean, hasError: boolean): string | undefined {
  return [hasHint ? hintId(id) : '', hasError ? errorId(id) : ''].filter(Boolean).join(' ') || undefined;
}
