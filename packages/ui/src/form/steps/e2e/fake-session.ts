import type { FieldIssue, FormModel, FormSession, Json } from '../../contract';

/**
 * A tiny stand-in for the form session of the harness page: required fields only. The e2e checks the flow and the layout
 * at both sizes; the rules themselves are core.form's and are tested there (the real session pulls the compiler in, which
 * the participant code, and so this page, does not import).
 */
export function fakeSession(
  model: FormModel,
  required: readonly string[],
  initial: Record<string, Json> = {},
): FormSession {
  const values: Record<string, Json> = { ...initial };
  const listeners = new Set<() => void>();
  const validatePage = (page: number): FieldIssue[] =>
    (model.pages[page] ?? [])
      .filter((f) => required.includes(f.key) && (values[f.key] === undefined || values[f.key] === ''))
      .map((f) => ({ fieldKey: f.key, fieldId: f.id, kind: 'required' as const }));
  return {
    model,
    locale: 'de',
    setLocale: () => undefined,
    draft: () => ({ ...values }),
    submitValues: () => ({ ...values }),
    get: (key) => values[key],
    set: (key, value) => {
      values[key] = value;
      for (const fn of [...listeners]) fn();
    },
    isRelevant: () => true,
    isRequired: (key) => required.includes(key),
    isReadonly: () => false,
    offered: () => undefined,
    waitingForSource: () => false,
    clearing: () => [],
    submitValuesCleared: () => ({ ...values }),
    visibleFields: (page) => model.pages[page] ?? [],
    validatePage,
    validateAll: () => model.pages.flatMap((_, i) => validatePage(i)),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
