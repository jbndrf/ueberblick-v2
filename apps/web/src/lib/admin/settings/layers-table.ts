/**
 * The layer table as data (v3 `LayersSection.svelte:127-194`): the rows BaseTable shows and its columns: Layer-Name,
 * Typ, Deckkraft (in %), Sichtbar für Rollen (editable picker), Basis. v4 adds the position (draw order, which the row
 * menu moves), "Beim Start an" (the file's `on_at_start`) and how the browser gets the layer (the tile proxy, A-033).
 */
import type { TableColumn, TableRow } from '@ueberblick/ui/components/admin';
import type { Snippet } from 'svelte';
import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
import type { LayerRowData, RoleOption } from './layers-model';

export const KEYS = {
  position: 'position',
  name: 'name',
  type: 'type',
  opacity: 'opacity',
  roles: 'roles',
  base: 'base',
  start: 'start',
  proxy: 'proxy',
} as const;

/** v3 capitalised the type (`source_type.charAt(0).toUpperCase()`); the registry keys read better as their usual names. */
const TYPE_LABEL: Record<string, string> = {
  xyz: 'XYZ',
  wms: 'WMS',
  pmtiles: 'PMTiles',
  geojson: 'GeoJSON',
  preset: 'Preset',
};

/** One row per layer, in draw order; `id` is the layer key. */
export const rowsOf = (layers: readonly LayerRowData[]): TableRow[] =>
  layers.map((l, i) => ({
    id: l.key,
    [KEYS.position]: i + 1,
    [KEYS.name]: l.label,
    [KEYS.type]: TYPE_LABEL[l.type] ?? l.type,
    [KEYS.opacity]: l.opacity,
    [KEYS.roles]: [...l.roles],
    [KEYS.base]: l.kind === 'base',
    [KEYS.start]: l.onAtStart,
    [KEYS.proxy]: l.proxied,
  }));

export function tableColumns(
  locale: Locale,
  roles: readonly RoleOption[],
  proxyCell: Snippet<[{ value: unknown; row: TableRow }]>,
): TableColumn[] {
  const t = (key: AdminKey): string => adminMessage(locale, key);
  return [
    {
      key: KEYS.position,
      label: t('settings_layers_col_position'),
      kind: 'number',
      editable: false,
      filterable: false,
      minWidth: 90,
    },
    { key: KEYS.name, label: t('settings_layers_col_name'), kind: 'text', editable: true },
    { key: KEYS.type, label: t('settings_layers_col_type'), kind: 'text', editable: false },
    {
      key: KEYS.opacity,
      label: t('settings_layers_col_opacity'),
      kind: 'number',
      editable: true,
      filterable: false,
    },
    {
      key: KEYS.roles,
      label: t('settings_layers_col_roles'),
      kind: 'array',
      editable: true,
      options: roles.map((r) => ({ value: r.key, label: r.label })),
      emptyText: t('settings_layers_all_roles'),
      emptyLabel: t('settings_layers_all_roles'),
    },
    { key: KEYS.base, label: t('settings_layers_col_base'), kind: 'boolean', editable: false },
    { key: KEYS.start, label: t('settings_layers_col_start'), kind: 'boolean', editable: true },
    {
      key: KEYS.proxy,
      label: t('settings_layers_col_fetch'),
      kind: 'custom',
      editable: false,
      cell: proxyCell,
    },
  ];
}
