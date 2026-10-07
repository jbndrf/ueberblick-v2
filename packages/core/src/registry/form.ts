import { defineRegistry, type KeyOf } from './define';

/** Why a form field's value is not accepted (ODK semantics, decision 0015). */
export const FORM_FIELD_ISSUES = defineRegistry([
  { key: 'required', description: 'A relevant, required field has no value.' },
  { key: 'constraint', description: 'The constraint evaluated false (or errored) for the value.' },
  { key: 'type', description: 'The value does not fit the property type.' },
  {
    key: 'option',
    description: 'A select answer is not among the options the form entry `choice_filter` offers.',
  },
  {
    key: 'readonly',
    description: 'A value was supplied for a readonly field that differs from its computed value.',
  },
] as const);
export type FormFieldIssue = KeyOf<typeof FORM_FIELD_ISSUES>;

/** The `appearance` tokens of a form field (ODK vocabulary). A field's `appearance` is a space-separated list of these. */
export const FORM_APPEARANCES = defineRegistry([
  { key: 'multiline', description: 'Draws a text input as a textarea (v3 long text).' },
  { key: 'email', description: 'Draws a text input as type=email (v3 email field).' },
] as const);
export type FormAppearance = KeyOf<typeof FORM_APPEARANCES>;
