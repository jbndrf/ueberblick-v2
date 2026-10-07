/**
 * Whether the template's `lock` forbids what a catalog create would write (Q30). The chips show a locked
 * create disabled with "Von der Vorlage gesperrt" and the frame maps a refused create to a message key,
 * so the engine's English refusal text never reaches the admin (WP-515). Pure functions of the document.
 */
import { lockOf, type Doc, type Op } from '../../doc';
import { createOp, type CatalogCreate, type NewNames } from './ops';

/** True when one of the ops writes a path the template locks (or inside / above a locked path). */
export function opsLocked(doc: Doc, ops: readonly Op[]): boolean {
  return ops.some((op) => lockOf(doc, op.path, op.kind) !== undefined);
}

/** True when the create the chip stands for would write a locked path. */
export function createLocked(
  doc: Doc,
  type: string,
  req: CatalogCreate,
  locale: string,
  names: NewNames,
): boolean {
  const made = createOp(doc.effective(), type, req, locale, names);
  return made.ok && opsLocked(doc, [made.op, ...(made.after ?? [])]);
}
