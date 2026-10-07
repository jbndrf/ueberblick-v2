/**
 * The ODK vocabulary of a form field (docs/05, `FormFieldSchema`) and how the lens edits each
 * attribute. The spec keeps this table in step with the file schema: a new attribute there fails
 * the test until it is listed here.
 */

/** How an attribute is edited: a yes/no that may also be an expression, a condition (chips), an expression, text, or the page of the form (a switch plus title and description). */
export const ATTRIBUTE_KINDS = ['flag', 'condition', 'expression', 'localized', 'text', 'page'] as const;
export type AttributeKind = (typeof ATTRIBUTE_KINDS)[number];

export interface FieldAttribute {
  readonly key: string;
  readonly kind: AttributeKind;
}

/** In the order the field card shows them: the most used first. */
export const FIELD_ATTRIBUTES: readonly FieldAttribute[] = [
  { key: 'required', kind: 'flag' },
  { key: 'relevant', kind: 'condition' },
  { key: 'readonly', kind: 'flag' },
  { key: 'constraint', kind: 'expression' },
  { key: 'constraint_message', kind: 'localized' },
  { key: 'calculate', kind: 'expression' },
  { key: 'choice_filter', kind: 'expression' },
  { key: 'label', kind: 'localized' },
  { key: 'placeholder', kind: 'localized' },
  { key: 'page', kind: 'page' },
  { key: 'appearance', kind: 'text' },
  { key: 'tool', kind: 'text' },
];
