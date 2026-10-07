/**
 * The form session of a Protokoll (WP-372): the record of a past run, not an open form. It holds the values the server
 * sent (already filtered by what the viewer may read) and decides nothing: no relevance, no required, no validation,
 * because the run was accepted and those rules ran when it was made. The renderer's `readonly` mode draws it.
 */
import type { Json as ReadonlyJson } from '@ueberblick/core/model';
import type { FormModel, FormSession, Json } from '@ueberblick/ui';

/** The server's values are readonly; the form session hands out mutable copies. */
function thaw(value: ReadonlyJson): Json {
  if (Array.isArray(value)) return (value as readonly ReadonlyJson[]).map(thaw);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, thaw(item)]));
  }
  return value;
}

export function protokollSession(
  model: FormModel,
  frozen: Readonly<Record<string, ReadonlyJson>>,
  locale: string,
): FormSession {
  const values = Object.fromEntries(Object.entries(frozen).map(([key, item]) => [key, thaw(item)]));
  const copy = (): Record<string, Json> => ({ ...values });
  return {
    model,
    locale,
    // a frozen record in the language the page opened with
    setLocale: () => undefined,
    draft: copy,
    submitValues: copy,
    submitValuesCleared: copy,
    get: (key) => values[key],
    set: () => undefined,
    isRelevant: () => true,
    isRequired: () => false,
    // The renderer's `readonly` mode marks the inputs; a field is never `disabled` here.
    isReadonly: () => false,
    offered: () => undefined,
    waitingForSource: () => false,
    clearing: () => [],
    visibleFields: (page) => model.pages[page] ?? [],
    validatePage: () => [],
    validateAll: () => [],
    subscribe: () => () => undefined,
  };
}
