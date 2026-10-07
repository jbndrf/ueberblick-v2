/**
 * The sidebar's Objektarten and Tabellen as data (WP-343), and the two overlay edits the sidebar makes:
 * a new type (`add`) and a new order (`order`, WP-333). Pure: no DOM, no I/O. v3 listed workflows and
 * custom tables (`reference/src/routes/admin/+layout.svelte:430-540`); in v4 both are feature types, told
 * apart by their shape (A-030): a type without geometry and without a process is a Tabelle.
 */
import type { Op } from '@ueberblick/builder';
import { isTable, keyFromName, localize, type TemplateFile } from '@ueberblick/core';

export const SIDEBAR_KINDS = ['objektart', 'table'] as const;
export type SidebarKind = (typeof SIDEBAR_KINDS)[number];

export interface SidebarType {
  readonly key: string;
  readonly label: string;
  readonly kind: SidebarKind;
  /** v3 marked a map workflow with a pin and a survey with a workflow icon (`+layout.svelte:487-491`). */
  readonly geometry: boolean;
}

export interface SidebarGroups {
  readonly objektarten: readonly SidebarType[];
  readonly tabellen: readonly SidebarType[];
}

/** The project's types in their effective order (a reordered map comes ordered). */
export function sidebarTypesOf(file: TemplateFile, locale: string): SidebarType[] {
  return Object.entries(file.types ?? {}).map(([key, t]) => ({
    key,
    label: localize(t.label, [locale]) || key,
    kind: isTable(t) ? 'table' : 'objektart',
    geometry: t.geometry !== undefined,
  }));
}

/**
 * Where a sidebar entry leads. An Objektart opens its data page (v3 workflow entries led to the workflow's table,
 * `+layout.svelte:487-500`; the builder is that page's "Builder" button, S3-18). A Tabelle opens its table page
 * (v3 `custom-tables/[tableId]`, `+layout.svelte:520-531`; WP-382).
 */
export function entryHref(project: string, type: Pick<SidebarType, 'key' | 'kind'>): string {
  return type.kind === 'objektart'
    ? `/admin/projects/${project}/types/${type.key}`
    : `/admin/projects/${project}/tables/${type.key}`;
}

/** The Tabellen overview (v3 `custom-tables/+page.svelte`): the group header of the sidebar opens it. */
export const tablesHref = (project: string): string => `/admin/projects/${project}/tables`;

export function groupTypes(types: readonly SidebarType[]): SidebarGroups {
  return {
    objektarten: types.filter((t) => t.kind === 'objektart'),
    tabellen: types.filter((t) => t.kind === 'table'),
  };
}

/** A key (`^[a-z][a-z0-9_]*$`) from a name, unique among `taken` (core's `keyFromName`, shared with the GeoJSON wizard). */
export const typeKeyFor = (name: string, taken: readonly string[]): string =>
  keyFromName(name, taken, 'objektart');

/**
 * The entry of a new type. v3 created a point workflow named "New Incident Workflow" and a table named
 * "New Table" (`+layout.svelte:157-180,244-259`); the Objektart gets its point geometry, the Tabelle one text
 * column (visible to every role), so both compile without problems and the admin can go on in the builder.
 */
export function newTypeEntry(kind: SidebarKind, name: string): Record<string, unknown> {
  if (kind === 'table')
    return {
      label: name,
      // v3's tables were visible to every role unless the admin narrowed it ("Sichtbar für Rollen"); no `see` shows to nobody.
      permissions: { see: '$all' },
      properties: { name: { type: 'text', label: 'Name', required: true } },
    };
  return {
    label: name,
    geometry: 'geometrie',
    properties: { geometrie: { type: 'geometry', geometry_type: 'point', required: true } },
  };
}

/** The op that adds a type: an `add` entry of the overlay (`types.<key>`). */
export function addTypeOp(key: string, entry: Record<string, unknown>): Op {
  return { kind: 'add', path: `types.${key}`, value: entry };
}

/**
 * The order of all types after one group was reordered: the group's keys fill the slots the group held, so the
 * other group keeps its place (the overlay has one `order` list for every type).
 */
export function reorderGroup(all: readonly string[], groupNew: readonly string[]): string[] {
  const inGroup = new Set(groupNew);
  const queue = [...groupNew];
  return all.map((k) => (inGroup.has(k) ? (queue.shift() as string) : k));
}

/** The op that writes the order of all types as the overlay's `order.types` (WP-333). */
export function orderTypesOp(keys: readonly string[]): Op {
  return { kind: 'order', path: 'types', keys: [...keys] };
}
