import { defineRegistry, type KeyOf } from './define';

/** Where an element of the effective config comes from (docs/05, builder marks). */
export const PROVENANCES = defineRegistry([
  { key: 'template', description: 'Unchanged from the template.' },
  { key: 'changed', description: 'Overridden by the overlay.' },
  { key: 'added', description: 'Added by the overlay.' },
] as const);
export type Provenance = KeyOf<typeof PROVENANCES>;

/** Problems found while merging a template with an overlay. */
export const TEMPLATE_ISSUE_CODES = defineRegistry([
  { key: 'lock_violation', description: 'The overlay touches a path the template locked.' },
  { key: 'unknown_path', description: 'The overlay addresses a path the template does not have.' },
  { key: 'path_exists', description: 'The overlay adds a path the template already has.' },
  { key: 'hidden_referenced', description: 'A hidden entity is still referenced by the effective config.' },
] as const);
export type TemplateIssueCode = KeyOf<typeof TEMPLATE_ISSUE_CODES>;

/** Changes a minor template version may not contain (docs/05 "Minor versions"). */
export const TEMPLATE_BREAKING_KINDS = defineRegistry([
  { key: 'key_removed', description: 'A key present in the old version is missing.' },
  { key: 'type_changed', description: 'A property changed its type.' },
  { key: 'option_removed', description: 'A select option was removed.' },
] as const);
export type TemplateBreakingKind = KeyOf<typeof TEMPLATE_BREAKING_KINDS>;
