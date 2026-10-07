/**
 * The edits of the Objektart settings pane (v3 `SharedSidebar.svelte:99-142`, the `workflow` pane). Each one is the op of
 * the place it has elsewhere (R1): the name is the toolbar's `setLabelOp`, "Sichtbar für Rollen" is the permission matrix's
 * `cellOp` on the whole-type row `see` (also the data page header's), "Private Einträge" is the matrix's `privateOp`, and a
 * role made in the picker is the task pane's `createRoleOps`.
 */
import type { TemplateFile } from '@ueberblick/core';
import type { Op } from '../../doc';
import { setLabelOp } from '../../lenses/data-model/ops';
import { typeAudience } from '../model/permissions/model';
import { cellOp } from '../model/permissions/ops';

export { createRoleOps } from '../task/ops';
export { privateOp, privateState } from '../model/permissions/ops';

/** The roles that see the type; `undefined` when the file keys the audience by property (the matrix sets that). */
export function visibleRoles(file: TemplateFile, type: string): readonly string[] | undefined {
  const a = typeAudience(file, type, 'see');
  if (a === undefined) return undefined;
  return a.kind === 'roles' ? a.roles : [];
}

/** Empty means every role (v3: an empty `visible_to_roles`). */
export function visibleRolesOp(file: TemplateFile, type: string, roles: readonly string[]): Op | undefined {
  return cellOp(
    file,
    type,
    { action: 'see' },
    roles.length === 0 ? { kind: 'all' } : { kind: 'roles', roles },
  );
}

/** The new name of the type, or `undefined` for an empty one (the toolbar's rule: an empty name is not taken). */
export function renameOp(file: TemplateFile, type: string, locale: string, name: string): Op | undefined {
  const text = name.trim();
  return text === '' ? undefined : setLabelOp(file, `types.${type}`, locale, text);
}
