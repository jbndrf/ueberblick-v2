/**
 * The edits of the permission matrix as `Doc.apply` ops. Pure (R1, H4): the matrix, tests and assistants share
 * them. A property row goes through `field/perms.ts` (the same ops the field pane writes); a whole-type row
 * rewrites `permissions.<action>`; "Private" writes `visible_when`.
 */
import { AUDIENCES, type PermAction, type TemplateFile } from '@ueberblick/core';
import type { Doc, Op } from '../../../doc';
import { visibleWhenOp } from '../../../lenses/roles/ops';
import { permissionsOp, setPropertyAudienceOp, type SettableAudience } from '../../field/perms';
import { rowAudience, toggledAudience, type MatrixRowModel } from './model';

const ALL = AUDIENCES.keys[0];

/** The row filter of "Private Instanzen" (v3: only the creator sees an instance); `$created_by` is a system field (WP-306). */
export const PRIVATE_WHEN = 'self.$created_by == actor.id';

export interface RowRef {
  readonly action: PermAction;
  readonly property?: string;
}

/** The op that gives one row exactly `next` as its audience; undefined when it has it already or the row is locked. */
export function cellOp(
  file: TemplateFile,
  type: string,
  row: RowRef,
  next: SettableAudience,
): Op | undefined {
  if (row.property !== undefined) {
    if (row.action !== 'see' && row.action !== 'write') return undefined;
    return setPropertyAudienceOp(file, type, row.action, row.property, next);
  }
  const now = rowAudience(file, type, row.action);
  if (now === undefined) return undefined;
  const same =
    now.kind === next.kind &&
    (now.kind !== 'roles' ||
      (next.kind === 'roles' &&
        now.roles.length === next.roles.length &&
        now.roles.every((r) => next.roles.includes(r))));
  if (same) return undefined;
  const value = next.kind === 'all' ? ALL : next.kind === 'roles' ? [...next.roles] : [];
  return permissionsOp(file, type, row.action, value);
}

/** The op for clicking the cell of `role` in `row`. */
export function toggleOp(
  doc: Doc,
  type: string,
  row: MatrixRowModel,
  role: string,
  allRoles: readonly string[],
): Op | undefined {
  if (row.audience === undefined) return undefined;
  return cellOp(doc.effective(), type, row, toggledAudience(row.audience, role, allRoles));
}

/** The op that puts one cell back to what its template says (the cell's own provenance reset); undefined when it is not modified. */
export function resetOp(
  doc: Doc,
  type: string,
  row: MatrixRowModel,
  role: string,
  allRoles: readonly string[],
): Op | undefined {
  if (row.cells.find((c) => c.role === role)?.modified !== true) return undefined;
  return toggleOp(doc, type, row, role, allRoles);
}

/** `on`: only the creator sees an object; `custom`: another `visible_when` is set (edited in the Code view). */
export const PRIVATE_STATES = ['off', 'on', 'custom'] as const;
export type PrivateState = (typeof PRIVATE_STATES)[number];

export function privateState(file: TemplateFile, type: string): PrivateState {
  const when = file.types?.[type]?.permissions?.visible_when;
  if (when === undefined) return 'off';
  return when === PRIVATE_WHEN ? 'on' : 'custom';
}

/** The op of the "Private" switch. A custom condition is never overwritten (undefined). */
export function privateOp(doc: Doc, type: string, on: boolean): Op | undefined {
  const now = privateState(doc.effective(), type);
  if (now === 'custom' || (now === 'on') === on) return undefined;
  return visibleWhenOp(doc, type, on ? PRIVATE_WHEN : '');
}
