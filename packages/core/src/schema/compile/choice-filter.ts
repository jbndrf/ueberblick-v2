/** WP-392: where a form entry's `choice_filter` is allowed (ODK: only on a choice question). */
import type { Sink } from './problems';

const CHOICE_TYPES: readonly string[] = ['select', 'multiselect'];

/** Reports `choice_filter_invalid` when the property is known and is not a select or multiselect; true when it did. */
export function refuseChoiceFilter(
  sink: Sink,
  path: string,
  field: string,
  type: string | undefined,
): boolean {
  if (type === undefined || CHOICE_TYPES.includes(type)) return false;
  sink.error(
    path,
    'choice_filter_invalid',
    `\`choice_filter\` needs a select or multiselect property, but '${field}' is ${type}`,
    'remove `choice_filter`, or bind the field to a select or multiselect property',
    { field, kind: type },
  );
  return true;
}
