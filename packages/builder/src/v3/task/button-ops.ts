/**
 * Definition's Farbe, Symbol and "Bestätigung verlangen" (v3 `TaskConfigSidebar.svelte:288-332`, v3's
 * `visual.button_color`, `button_icon`, `requires_confirmation`, `confirmation_message`) as Doc ops: the
 * task's `button.color` (a `TASK_BUTTON_COLORS` key or `#rrggbb`), `button.icon` and `confirm`. Pure (R1).
 */
import type { Doc, Op } from '../../doc';
import { clearOps, localizedText, setOps, withLocalized } from '../../lenses/task/edit';

const at = (task: string): string => `tasks.${task}`;
const lang = (locale: string): string => locale.split('-')[0] ?? locale;

/** `button.<key>` = `text` (empty text removes it; the attribute `button` is made when absent). */
export function buttonOps(doc: Doc, task: string, key: 'color' | 'icon', text: string): readonly Op[] {
  const t = doc.effective().tasks?.[task];
  if (t === undefined) return [];
  const value = text.trim();
  if (value === '') return t.button?.[key] === undefined ? [] : clearOps(doc, `${at(task)}.button.${key}`);
  if (t.button === undefined) return setOps(doc, `${at(task)}.button`, { [key]: value });
  return setOps(doc, `${at(task)}.button.${key}`, value);
}

/**
 * "Bestätigung verlangen": on writes `confirm` (with `standard` as its text when none is there yet, so the
 * file, not the pane, holds the state); off removes it.
 */
export function confirmOps(
  doc: Doc,
  task: string,
  locale: string,
  on: boolean,
  standard: string,
): readonly Op[] {
  const current = doc.effective().tasks?.[task]?.confirm;
  if (!on) return current === undefined ? [] : clearOps(doc, `${at(task)}.confirm`);
  if (current !== undefined) return [];
  return setOps(doc, `${at(task)}.confirm`, { [lang(locale)]: standard });
}

/** The confirmation text in `locale` ("Nachricht"); empty text is not written (it would turn the question off). */
export function confirmTextOps(doc: Doc, task: string, locale: string, text: string): readonly Op[] {
  if (text.trim() === '') return [];
  const value = withLocalized(doc.effective().tasks?.[task]?.confirm, locale, text);
  return value === undefined ? [] : setOps(doc, `${at(task)}.confirm`, value);
}

export { localizedText };
