/**
 * The one-line outcome of an automatic action (C-004 step 1): the `then` steps of the task it owns,
 * for example "Priorität → hoch". A pure read of the effective file; the pane edits the steps themselves.
 */
import { LIFECYCLE_STATES, type Property, type TemplateFile } from '@ueberblick/core';
import { literalOption } from '../../lenses/process/graph';
import { labelOf } from '../../shell/location';
import { subjectTypeOf } from '../task/step-ops';

/** The words a summary needs from the message catalog. */
export interface SummaryWords {
  readonly yes: string;
  readonly no: string;
  readonly empty: string;
  readonly lifecycle: string;
}

function valueText(prop: Property | undefined, value: unknown, locale: string, words: SummaryWords): string {
  if (value === true) return words.yes;
  if (value === false) return words.no;
  if (value === null) return words.empty;
  const option = literalOption(value);
  if (option !== undefined) return labelOf(prop?.options?.[option], locale, option);
  return String(value);
}

const lifecycleText = (key: string, locale: string): string => {
  const label = LIFECYCLE_STATES.get(key as never).label as Readonly<Record<string, string>>;
  return label[locale] ?? label.en ?? key;
};

/** One entry per changed property, in step order: "Eskaliert → ja", "Priorität → hoch"; a lifecycle step "Zustand → archiviert". */
export function outcomeParts(
  file: TemplateFile,
  task: string,
  fallbackType: string,
  locale: string,
  words: SummaryWords,
): readonly string[] {
  const def = file.tasks?.[task];
  if (def === undefined) return [];
  const props = file.types?.[subjectTypeOf(file, task, fallbackType)]?.properties ?? {};
  const parts: string[] = [];
  for (const step of def.then ?? []) {
    for (const [key, value] of Object.entries(step.set ?? {}))
      parts.push(
        `${labelOf(props[key]?.label, locale, key)} → ${valueText(props[key], value, locale, words)}`,
      );
    if (step.lifecycle !== undefined)
      parts.push(`${words.lifecycle} → ${lifecycleText(step.lifecycle, locale)}`);
  }
  return parts;
}
