/**
 * What an admin reads when the draft refuses an edit (WP-516, WP-518). The engine's refusal text is English and
 * meant for logs, so it never reaches the screen. A path the template locks says "Von der Vorlage gesperrt"; a
 * refusal that carries checker problems says "Nicht übernommen: <the problem in the admin's language>"
 * (`problemText`, R1); any other refusal has a wording per `RefusalCode`; an unknown code gets the generic
 * `frame_refused` line. Pure function of the document, the ops that were tried and the refusal.
 */
import { isRefusalCode, type Doc, type Op, type Refusal } from '../../doc';
import { problemText } from '../../problems/text';
import type { Translate } from '../../shell/messages';
import { opsLocked } from '../catalog/lock';

export function refusalText(
  t: Translate,
  doc: Doc,
  ops: readonly Op[],
  refused?: Refusal,
  locale = 'de',
): string {
  if (opsLocked(doc, ops)) return t('catalog_locked');
  if (refused === undefined) return t('frame_refused');
  const first = refused.problems?.[0];
  if (first !== undefined) {
    const { message, hint } = problemText(first, locale);
    return t('task_not_applied', { message: hint === undefined ? message : `${message} ${hint}` });
  }
  const code: string = refused.code;
  if (!isRefusalCode(code)) return t('frame_refused');
  return t(`refusal_${code}`, refused.params);
}
