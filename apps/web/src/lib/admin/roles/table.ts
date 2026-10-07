/**
 * The roles table as data (v3 `roles/+page.svelte:276-336`): the rows BaseTable shows and its columns. the Selbstbeitritt
 * column is a live switch (v3 `booleanConfig.onToggle`, WP-367).
 */
import type { TableColumn, TableRow } from '@ueberblick/ui/components/admin';
import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
import type { RoleRowData } from './types';

export const KEYS = {
  name: 'name',
  description: 'description',
  selfJoin: 'self_join',
  members: 'members',
} as const;

/** One row per role; `id` is the role key and `members` the count v3's "Zugewiesene Teilnehmende" column shows. */
export const rowsOf = (roles: readonly RoleRowData[]): TableRow[] =>
  roles.map((r) => ({
    id: r.key,
    [KEYS.name]: r.label,
    [KEYS.description]: r.description,
    [KEYS.selfJoin]: r.selfJoin?.enabled ?? false,
    [KEYS.members]: r.members.length,
  }));

export function tableColumns(locale: Locale): TableColumn[] {
  const t = (key: Parameters<typeof adminMessage>[1]): string => adminMessage(locale, key);
  return [
    { key: KEYS.name, label: t('rol_name'), kind: 'text', editable: true },
    { key: KEYS.description, label: t('rol_description_field'), kind: 'text', editable: true },
    { key: KEYS.selfJoin, label: t('rol_self_join'), kind: 'boolean', editable: true, live: true },
    { key: KEYS.members, label: t('rol_col_members'), kind: 'number', editable: false, filterable: false },
  ];
}
