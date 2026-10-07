/**
 * The Teilnehmende table as data (v3 `participants/+page.svelte:212-320`, `columns.ts`): the rows BaseTable shows, its
 * columns (Name, E-Mail, Telefon, Zugangstoken, Rollen, Status, then the admin's own), and what an in-place edit sends.
 */
import type { TableColumn, TableRow } from '@ueberblick/ui/components/admin';
import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
import type { PersonPatch } from './api';
import type { CustomColumn, RoleOption, RosterPerson } from './types';

/** Table keys of the six fixed columns; an admin column is `attr_<key>`. */
export const KEYS = {
  name: 'name',
  email: 'email',
  phone: 'phone',
  token: 'token',
  roles: 'roles',
  active: 'is_active',
} as const;
const ATTR = 'attr_';
export const attrKey = (key: string): string => `${ATTR}${key}`;

/** The link a login badge or a pasted message opens: the sign-in page reads `?token=` (WP-607). */
export const loginLink = (origin: string, token: string): string =>
  `${origin}/login?token=${encodeURIComponent(token)}`;

export function rowsOf(people: readonly RosterPerson[], columns: readonly CustomColumn[]): TableRow[] {
  return people.map((p) => {
    const row: TableRow = {
      id: p.id,
      [KEYS.name]: p.name ?? '',
      [KEYS.email]: p.email ?? '',
      [KEYS.phone]: p.phone ?? '',
      [KEYS.token]: p.token ?? '',
      [KEYS.roles]: [...p.roles],
      [KEYS.active]: p.disabledAt === null,
    };
    for (const c of columns) row[attrKey(c.key)] = p.attrs[c.key] ?? null;
    return row;
  });
}

const CELL_OF_TYPE: Readonly<Record<string, TableColumn['kind']>> = {
  text: 'text',
  number: 'number',
  boolean: 'boolean',
  date: 'date',
};

export interface ColumnSetup {
  readonly locale: Locale;
  readonly origin: string;
  readonly roles: readonly RoleOption[];
  readonly columns: readonly CustomColumn[];
  readonly createRole: (name: string) => Promise<RoleOption | null>;
}

export function tableColumns(setup: ColumnSetup): TableColumn[] {
  const t = (key: Parameters<typeof adminMessage>[1]): string => adminMessage(setup.locale, key);
  const core: TableColumn[] = [
    { key: KEYS.name, label: t('prt_col_name'), kind: 'text', editable: true },
    { key: KEYS.email, label: t('prt_col_email'), kind: 'text', editable: true },
    { key: KEYS.phone, label: t('prt_col_phone'), kind: 'text', editable: true },
    {
      key: KEYS.token,
      label: t('prt_col_token'),
      kind: 'text',
      editable: true,
      copyable: true,
      // v3 copied the token; the token now opens the login (owner §10.21), so the link is what gets sent.
      copyValue: (row) => loginLink(setup.origin, String(row[KEYS.token] ?? '')),
      sortable: false,
      filterable: false,
    },
    {
      key: KEYS.roles,
      label: t('prt_col_roles'),
      kind: 'array',
      editable: true,
      sortable: false,
      options: setup.roles.map((r) => ({
        value: r.key,
        label: r.label,
        ...(r.pending ? { description: t('prt_role_new') } : {}),
      })),
      emptyText: t('prt_roles_ph'),
      onCreateEntity: async (name) => {
        const made = await setup.createRole(name);
        if (!made) throw new Error('role not created');
        return {
          value: made.key,
          label: made.label,
          ...(made.pending ? { description: t('prt_role_new') } : {}),
        };
      },
    },
    { key: KEYS.active, label: t('prt_col_status'), kind: 'boolean', editable: true, live: true },
  ];
  const own: TableColumn[] = setup.columns.map((c) => ({
    key: attrKey(c.key),
    label: c.label,
    kind: CELL_OF_TYPE[c.type] ?? 'text',
    editable: true,
  }));
  return [...core, ...own];
}

/** A typed value for a column of the given type: numbers and empty strings need care, `null` clears. */
export function attrValue(type: string, value: unknown): string | number | boolean | null {
  if (value === null || value === undefined || value === '') return null;
  if (type === 'number') return Number(value);
  if (type === 'boolean') return value === true || value === 'true';
  return String(value);
}

/** What one in-place edit of a cell sends to the roster route. */
export function patchOf(key: string, value: unknown, columns: readonly CustomColumn[]): PersonPatch | null {
  switch (key) {
    case KEYS.name:
      return { name: String(value ?? '') };
    case KEYS.email:
      return { email: value === '' ? null : String(value) };
    case KEYS.phone:
      return { phone: value === '' ? null : String(value) };
    case KEYS.roles:
      return { roles: Array.isArray(value) ? value.map(String) : [] };
    case KEYS.active:
      return { disabled: value !== true };
    default: {
      const column = columns.find((c) => attrKey(c.key) === key);
      return column ? { attrs: { [column.key]: attrValue(column.type, value) } } : null;
    }
  }
}
