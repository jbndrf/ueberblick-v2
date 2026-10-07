import type { Translate } from '../../shell/messages';

/**
 * The kit MultiSelect's texts. The kit follows its own locale; the builder follows its `locale`, so every
 * text comes from the builder's messages. `RoleSelect` and `PropertyPicker` share this (R1).
 */
export function kitLabels(t: Translate, own: { placeholder: string; dialog: string; options: string }) {
  return {
    placeholder: own.placeholder,
    search: t('multiselect_search'),
    empty: t('multiselect_empty'),
    createHint: t('multiselect_create_hint'),
    createLabel: (query: string) => t('multiselect_create', { query }),
    countSelected: (count: number) => t('multiselect_count', { count }),
    removeOption: (option: string) => t('multiselect_remove', { option }),
    done: t('multiselect_done'),
    doneWithCount: (count: number) => t('multiselect_done_count', { count }),
    close: t('multiselect_close'),
    dialog: own.dialog,
    options: own.options,
  };
}
