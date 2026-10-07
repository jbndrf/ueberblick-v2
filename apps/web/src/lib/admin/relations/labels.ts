// The labels of the relation options, shared by the Beziehungen page and its dialog (one place, R1). The maps are
// keyed by the builder's registries (labels.spec.ts proves every key has one; the browser must not import the builder); a row carries
// plain strings across the server load, so the lookup takes a string and an unknown key shows as itself.
import type { RelationCardinality } from '@ueberblick/core';
import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
import type { Locale } from '../../../routes/(admin)/admin/shell/locale';

export const MULTIPLICITY: Record<RelationCardinality, AdminKey> = {
  one: 'rel_multiplicity_one',
  many: 'rel_multiplicity_many',
};
export const ATTACHMENT: Record<string, AdminKey> = {
  enforced: 'rel_attachment_enforced',
  optional: 'rel_attachment_optional',
};
export const ATTACHMENT_HELP: Record<string, AdminKey> = {
  enforced: 'rel_attachment_enforced_help',
  optional: 'rel_attachment_optional_help',
};
export const ON_DELETE: Record<string, AdminKey> = {
  cascade: 'rel_on_delete_cascade',
  nullify: 'rel_on_delete_nullify',
  block: 'rel_on_delete_block',
};
export const ON_DELETE_HELP: Record<string, AdminKey> = {
  cascade: 'rel_on_delete_cascade_help',
  nullify: 'rel_on_delete_nullify_help',
  block: 'rel_on_delete_block_help',
};
export const GEOMETRY: Record<string, AdminKey> = {
  inherit: 'rel_geometry_inherit',
  draw: 'rel_geometry_draw',
  none: 'rel_geometry_none',
};
export const GEOMETRY_HELP: Record<string, AdminKey> = {
  inherit: 'rel_geometry_inherit_help',
  draw: 'rel_geometry_draw_help',
  none: 'rel_geometry_none_help',
};

/** The label of a registry key in `locale`; an unknown key (plain data from the server) shows as itself. */
export function relationLabel(locale: Locale, map: Readonly<Record<string, AdminKey>>, key: string): string {
  const label = map[key];
  return label ? adminMessage(locale, label) : key;
}
