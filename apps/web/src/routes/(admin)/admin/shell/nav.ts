/**
 * The sidebar as data (R13, H5): a later area is one entry here. Items, order and URLs follow v3's sidebar
 * (`reference/src/routes/admin/+layout.svelte:263-270`, groups `:430-540`); v3's "Releases" is "Versionen".
 */
import type { AdminKey } from './messages';
import type { SidebarKind } from './sidebar-types';

/** A project as the sidebar shows it. */
export interface ShellProject {
  readonly key: string;
  readonly name: string;
}

export const NAV_ICONS = [
  'projects',
  'settings',
  'participants',
  'roles',
  'relations',
  'versions',
  'objektart',
  'process',
  'tables',
] as const;
export type NavIcon = (typeof NAV_ICONS)[number];

export interface NavItem {
  readonly key: string;
  readonly href: string;
  readonly icon: NavIcon;
  readonly label: AdminKey;
}

export interface NavGroup {
  readonly key: string;
  readonly icon: NavIcon;
  readonly label: AdminKey;
  /** Shown while the group has no entries. */
  readonly empty: AdminKey;
  /** The "+" button's label (screen readers) and the entry of its menu. */
  readonly add: AdminKey;
  readonly create: AdminKey;
  readonly createError: AdminKey;
  /** The kind of type the group lists and its "+" creates (`sidebar-types.ts`). */
  readonly kind: SidebarKind;
}

export const PROJECTS_ITEM: NavItem = {
  key: 'projects',
  href: '/admin/projects',
  icon: 'projects',
  label: 'nav_projects',
};

/** A project's own pages, in v3's order. */
const PROJECT_PAGES: readonly (readonly [string, NavIcon, AdminKey])[] = [
  ['settings', 'settings', 'nav_project_settings'],
  ['participants', 'participants', 'nav_participants'],
  ['roles', 'roles', 'nav_roles'],
  ['relations', 'relations', 'nav_relations'],
  ['versions', 'versions', 'nav_versions'],
];

export const projectItems = (projectId: string): readonly NavItem[] =>
  PROJECT_PAGES.map(([page, icon, label]) => ({
    key: page,
    href: `/admin/projects/${projectId}/${page}`,
    icon,
    label,
  }));

export const GROUPS: readonly NavGroup[] = [
  {
    key: 'types',
    icon: 'objektart',
    label: 'nav_types',
    empty: 'nav_no_types',
    add: 'nav_add_type',
    create: 'nav_new_type',
    createError: 'nav_create_type_error',
    kind: 'objektart',
  },
  {
    key: 'tables',
    icon: 'tables',
    label: 'nav_tables',
    empty: 'nav_no_tables',
    add: 'nav_add_table',
    create: 'nav_new_table',
    createError: 'nav_create_table_error',
    kind: 'table',
  },
];

/** The project id in `/admin/projects/<id>/…`, if any. */
export function projectIdOf(pathname: string): string | null {
  return /^\/admin\/projects\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

/** The page of a type in the sidebar: its builder (the data page follows with S3-18). */
export const typeHref = (projectId: string, key: string): string =>
  `/admin/projects/${projectId}/types/${key}/builder`;

/** A type's entry is active on every page under `/admin/projects/<id>/types/<key>` and, for a table, `…/tables/<key>`. */
export const isTypeActive = (pathname: string, projectId: string, key: string): boolean =>
  ['types', 'tables'].some((section) => {
    const base = `/admin/projects/${projectId}/${section}/${key}`;
    return pathname === base || pathname.startsWith(`${base}/`);
  });

export const isActive = (pathname: string, href: string): boolean => pathname === href;

/** The item a path is the page of (for the placeholder's title). */
export function itemForPath(pathname: string): NavItem | null {
  if (pathname === PROJECTS_ITEM.href) return PROJECTS_ITEM;
  const id = projectIdOf(pathname);
  return id === null ? null : (projectItems(id).find((i) => i.href === pathname) ?? null);
}
