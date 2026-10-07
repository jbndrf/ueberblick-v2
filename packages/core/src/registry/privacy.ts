import { defineRegistry, type KeyOf } from './define';

/**
 * Whose data a personal property holds (`personal: { subject }`, B-005). Erasure and export use it
 * to know what to blank and whom the data belongs to. `property` is written `property:<key>`,
 * naming a participant property of the same feature type.
 */
export const PERSONAL_SUBJECT_KINDS = defineRegistry([
  { key: 'actor', description: 'The participant who submitted the run (for example a live position).' },
  { key: 'property', description: 'The participant named in a participant property: `property:<key>`.' },
  { key: 'feature', description: 'The feature itself is about a person.' },
] as const);
export type PersonalSubjectKind = KeyOf<typeof PERSONAL_SUBJECT_KINDS>;
