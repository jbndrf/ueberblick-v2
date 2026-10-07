/**
 * Personal data in a v3 project (WP-172, course check 004 finding 2.5). Since A-021 erasure only works when the
 * project file marks properties as `personal` and has a task with a `redact` step; the converter emits both.
 * The rule list is explicit and small. A field it misses is a one-line edit; a field it marks too eagerly is
 * listed in `ConvertResult.personal`, so an admin sees every decision.
 */
import type { FeatureType, Task } from '@ueberblick/core';
import type { KeySpace } from './keys';

/** The key of the erasure task, and the base key of the type its runs create. */
export const ERASE_TASK = 'erase_subject';
export const ERASURE_TYPE = 'erasure';

/** A property the converter marked as personal data, and why. */
export interface PersonalMark {
  /** The v4 path of the property, e.g. `types.baum.properties.kontakt`. */
  readonly target: string;
  readonly reason: string;
}

export interface PersonalField {
  readonly type: string;
  readonly key: string;
  readonly label: string;
  readonly options: Readonly<Record<string, unknown>>;
}

/** An e-mail field identifies a person by its type alone. */
const EMAIL_TYPE = 'email';

/** Field types the word list applies to: text, and a selector over participants (never roles or tables). */
const isNamedType = (f: PersonalField): boolean =>
  f.type === 'short_text' ||
  f.type === 'long_text' ||
  (f.type === 'custom_table_selector' && f.options['source_type'] === 'participants');

/**
 * Whole words (and compounds) that name a person or a way to reach one. A key or label is split into words first, and a
 * word must equal an entry: "mobilitaet" or "kontaktiert" do not match. Plain "name" is left out (trees have names), and
 * so is "zustaendig": a handler is not personal data of whoever assigned them (golden maengelmelder leaves it unmarked).
 */
const WORDS: ReadonlySet<string> = new Set([
  'melder',
  'melderin',
  'reporter',
  'einreicher',
  'antragsteller',
  'kontakt',
  'kontaktperson',
  'contact',
  'telefon',
  'telefonnummer',
  'tel',
  'phone',
  'handy',
  'handynummer',
  'mobil',
  'mobilnummer',
  'mail',
  'email',
  'emailadresse',
  'anschrift',
  'adresse',
  'address',
]);

/** Lower-case words of a key or label: split at `_`, `-`, spaces, other punctuation and camelCase boundaries. */
export const words = (s: string): string[] =>
  s
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((p) => p !== '');

/** Why a v3 field counts as personal data, or `undefined` when it does not. */
export function personalReason(f: PersonalField): string | undefined {
  if (f.type === EMAIL_TYPE) return 'an e-mail address identifies a person';
  if (!isNamedType(f)) return undefined;
  const hit = [...words(f.key), ...words(f.label)].find((w) => WORDS.has(w));
  return hit === undefined ? undefined : `named for a person or a way to reach one ("${hit}")`;
}

/**
 * The erasure task and the type its runs create (modelled on the golden maengelmelder template): a form with the
 * id of the person, and a `redact` step. Only admins may run it. Returns the keys it took.
 */
export function addErasure(
  tasks: Record<string, Task>,
  types: Record<string, FeatureType>,
  typeKeys: KeySpace,
  taskKeys: KeySpace,
): { task: string; type: string } {
  const type = typeKeys.take(ERASURE_TYPE);
  const task = taskKeys.take(ERASE_TASK);
  types[type] = {
    label: { de: 'Löschung', en: 'Erasure' },
    permissions: { see: [], create: [], write: '$all' },
    properties: { subject: { type: 'participant', required: true } },
  };
  tasks[task] = {
    label: { de: 'Person löschen', en: 'Erase a person' },
    on: '$none',
    who: ['admin'],
    creates: type,
    form: { subject: { required: true } },
    then: [{ redact: { subject: 'actor', of: 'form.subject' } }],
  };
  return { task, type };
}
