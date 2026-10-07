/**
 * The Doc ops of an inline rename (v3 `taskStore.renameStage` / task `visual.button_label`):
 * only the label in the builder's language changes; the key stays, so nothing that refers to it
 * breaks (docs/05: keys are identity). Other languages of the label are kept.
 */
import { formatKeyPath, type LocalizedString, type TemplateFile } from '@ueberblick/core';
import type { Op } from '../../doc';

function localized(current: LocalizedString | undefined, locale: string, text: string): LocalizedString {
  return typeof current === 'object' ? { ...current, [locale]: text } : { [locale]: text };
}

export function renameTaskOp(file: TemplateFile, task: string, locale: string, text: string): Op {
  return {
    kind: 'set',
    path: formatKeyPath(['tasks', task, 'label']),
    value: localized(file.tasks?.[task]?.label, locale, text),
  };
}
