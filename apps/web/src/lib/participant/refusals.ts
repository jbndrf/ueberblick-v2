/**
 * Why a run was refused, in one plain sentence (v3 `task-run-messages.ts`: `taskRunRejectionText`). The one place that
 * turns a refusal into words: the form (submitter), the status line, the run notices and the Einstellungen queue list
 * all call it (R1). The code and the developer message are not shown to the person; the engine keeps both on the run.
 */
import type { Refusal, TemplateFile } from '@ueberblick/core/model';
import type { QueueRunState } from '@ueberblick/core/registry';
// Type-only: `/registry` does not export the refusal codes (follow-up in the WP Notes), and no core code loads here.
import type { RefusalCode } from '@ueberblick/core';
import { resolveLabel } from '@ueberblick/ui';
import { message, type Locale, type MessageKey } from './messages';

export type RefusalKey = Extract<MessageKey, `refusal_${string}`>;

/** Every registry code has its sentence; a new code fails the type check until it gets one. */
const SENTENCE: Record<RefusalCode, RefusalKey> = {
  unknown_task: 'refusal_unknown_task',
  unknown_feature: 'refusal_unknown_feature',
  case_closed: 'refusal_case_closed',
  not_available: 'refusal_not_available',
  not_permitted: 'refusal_not_permitted',
  invalid_input: 'refusal_invalid_input',
  required_missing: 'refusal_required_missing',
  constraint_failed: 'refusal_constraint_failed',
  readonly_field: 'refusal_readonly_field',
  bind_unresolved: 'refusal_bind_unresolved',
  bind_undeclared: 'refusal_bind_undeclared',
  geometry_required: 'refusal_geometry_required',
  id_taken: 'refusal_id_taken',
  quota_exceeded: 'refusal_quota_exceeded',
  too_many_targets: 'refusal_too_many_targets',
  depth_exceeded: 'refusal_depth_exceeded',
  batch_failed: 'refusal_batch_failed',
  blob_mismatch: 'refusal_blob_mismatch',
  blob_too_large: 'refusal_blob_too_large',
  blob_lost: 'refusal_blob_lost',
  blob_missing: 'refusal_blob_missing',
  crs_undeclared: 'refusal_crs_undeclared',
  property_not_visible: 'refusal_property_not_visible',
  unknown_property: 'refusal_unknown_property',
};

/** The sentence of a code; a code this build does not know (a newer server) gets the general one. */
export const refusalSentenceKey = (code: string): RefusalKey =>
  Object.hasOwn(SENTENCE, code) ? SENTENCE[code as RefusalCode] : 'refusal_unknown';

/** The field a refusal path names (`form.key`, `input.key`, `properties.key`); undefined for other paths. */
export function fieldOfPath(path: string | undefined): string | undefined {
  const m = path === undefined ? null : /^(?:form|input|properties)\.([^.]+)$/.exec(path);
  return m?.[1];
}

/** The label of a field of a task, in the person's language: the form's own label, else the property's. */
export function fieldLabelOf(
  file: Pick<TemplateFile, 'tasks' | 'types'>,
  locale: Locale,
): (taskKey: string, fieldKey: string) => string | undefined {
  return (taskKey, fieldKey) => {
    const own = file.tasks?.[taskKey]?.form?.[fieldKey]?.label;
    const label =
      own ??
      Object.values(file.types ?? {})
        .map((t) => t.properties?.[fieldKey]?.label)
        .find((l) => l !== undefined);
    return label === undefined ? undefined : resolveLabel(label, locale, fieldKey);
  };
}

/** Resolves a field key to its label, or nothing; the caller binds the task. */
export type FieldLabel = (fieldKey: string) => string | undefined;

/** One refusal as plain language: the sentence, then "Feld: {label}" when it names a field the config can label. */
export function refusalText(
  locale: Locale,
  refusal: Partial<Refusal> & Pick<Refusal, 'code'>,
  fieldLabel?: FieldLabel,
): string {
  const parts = [message(locale, refusalSentenceKey(refusal.code))];
  const key = fieldOfPath(refusal.path);
  const label = key === undefined ? undefined : fieldLabel?.(key);
  if (label !== undefined) parts.push(message(locale, 'refusal_field', { field: label }));
  return parts.join(' ');
}

/** The text of a refused run: a dependent one (v3 `dependent_rejected`) says it rests on a refused change first. */
export function runRefusalText(
  locale: Locale,
  run: { readonly state: QueueRunState; readonly refusal?: Refusal },
  fieldLabel?: FieldLabel,
): string {
  const text = refusalText(locale, run.refusal ?? { code: '' }, fieldLabel);
  return run.state === 'dependent' ? `${message(locale, 'refusal_batch_failed')} ${text}` : text;
}
