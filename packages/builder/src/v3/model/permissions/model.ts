/**
 * The permission matrix of ONE Objektart as v3 drew it (`matrix-model.ts`): a Section -> Band -> Row tree whose
 * columns are the roles. What a cell shows comes from the matrix lens' `buildMatrix`, i.e. `core.perms` (R1); what
 * the file holds per row (its audience) comes from the same readers the field pane uses (`field/perms.ts`), so the
 * matrix and the in-context pickers of WP-337 are one model. Pure: no DOM, no I/O.
 */
import { AUDIENCES, type PermAction, type TemplateFile } from '@ueberblick/core';
import type { Doc } from '../../../doc';
import { buildMatrix, type Row } from '../../../lenses/roles/model';
import { labelOf } from '../../../shell/location';
import type { Translate } from '../../../shell/messages';
import { propertyAudience, type SettableAudience } from '../../field/perms';

const ALL = AUDIENCES.keys[0];

/** Why a row cannot be edited from here: the file keeps its audience elsewhere. */
export type Locked =
  /** `see` is one audience for the whole row, so a property cannot be restricted on its own. */
  | 'row'
  /** `see` is keyed by property: every role sees the objects. */
  | 'all_rows_visible';

export interface MatrixRole {
  readonly key: string;
  readonly label: string;
}

export interface MatrixCellModel {
  readonly role: string;
  /** What `core.perms` says for this role. */
  readonly allowed: boolean;
  /** The draft changed this cell against its template: shows the provenance mark and the reset. */
  readonly modified: boolean;
}

export interface MatrixRowModel {
  /** Stable (`baum.write.hoehe_m`); the key of the row. */
  readonly id: string;
  readonly label: string;
  /** What a screen reader names the row after: the property, or the row label. */
  readonly subject: string;
  readonly action: PermAction;
  /** Set on a property row. */
  readonly property?: string;
  /** Visual indent level (0 = top-level, 1 = nested). */
  readonly indent: 0 | 1;
  /** Only drawn in "Erweitert". */
  readonly advanced: boolean;
  /** What the file says for this row; absent while locked. */
  readonly audience?: SettableAudience;
  readonly locked?: Locked;
  readonly cells: readonly MatrixCellModel[];
}

export interface MatrixBandModel {
  readonly id: string;
  readonly label: string;
  readonly advanced: boolean;
  readonly rows: readonly MatrixRowModel[];
}

export interface MatrixSectionModel {
  readonly id: string;
  readonly label: string;
  readonly bands: readonly MatrixBandModel[];
}

export interface PermissionModel {
  /** False when the draft does not compile: no cell can be called effective then. */
  readonly available: boolean;
  readonly roles: readonly MatrixRole[];
  readonly sections: readonly MatrixSectionModel[];
}

/** v3's two levels of detail: the Erweitert rows (create, delete) are hidden in Einfach. */
export type Density = 'basic' | 'advanced';

/** The actions of a whole type that a cell edits (the whole-type write is set per property in v3). */
type TypeAction = Exclude<PermAction, 'write'>;

type Audience = string | readonly string[] | undefined;
const isMap = (v: unknown): boolean => v !== undefined && typeof v === 'object' && !Array.isArray(v);

/** The audience of a whole-type action; undefined when the file keys it by property. */
export function typeAudience(
  file: TemplateFile,
  type: string,
  action: TypeAction,
): SettableAudience | undefined {
  const v = file.types?.[type]?.permissions?.[action] as Audience | Record<string, Audience>;
  if (isMap(v)) return undefined;
  if (v === ALL) return { kind: 'all' };
  return Array.isArray(v) && v.length > 0 ? { kind: 'roles', roles: [...v] } : { kind: 'none' };
}

/** The audience of one row in `file`, or undefined when it is not settable from a cell. */
export function rowAudience(
  file: TemplateFile,
  type: string,
  action: PermAction,
  property?: string,
): SettableAudience | undefined {
  if (property === undefined) {
    return action === 'see' || action === 'create' || action === 'delete'
      ? typeAudience(file, type, action)
      : undefined;
  }
  if (action !== 'see' && action !== 'write') return undefined;
  const a = propertyAudience(file, type, action, property);
  return a.kind === 'row' ? undefined : a;
}

export const hasRole = (a: SettableAudience, role: string): boolean =>
  a.kind === 'all' || (a.kind === 'roles' && a.roles.includes(role));

/** v3 `toggleRoleInList`, with "nobody" where v3's empty list would have meant everybody. */
export function toggledAudience(
  a: SettableAudience,
  role: string,
  allRoles: readonly string[],
): SettableAudience {
  const current = a.kind === 'all' ? allRoles : a.kind === 'roles' ? a.roles : [];
  const next = current.includes(role) ? current.filter((r) => r !== role) : [...current, role];
  if (next.length === 0) return { kind: 'none' };
  return allRoles.every((r) => next.includes(r)) ? { kind: 'all' } : { kind: 'roles', roles: next };
}

interface RowSpec {
  readonly lens: Row;
  readonly label: string;
  /** What the row is about when read out of context: the property's name; the row label for a whole-type row. */
  readonly subject?: string;
  readonly indent: 0 | 1;
  readonly advanced: boolean;
}

function rowModel(spec: RowSpec, doc: Doc, type: string, roles: readonly MatrixRole[]): MatrixRowModel {
  const { lens } = spec;
  const file = doc.effective();
  const audience = rowAudience(file, type, lens.action, lens.property);
  const was = rowAudience(doc.template, type, lens.action, lens.property);
  const locked: Locked | undefined =
    audience !== undefined ? undefined : lens.property === undefined ? 'all_rows_visible' : 'row';
  return {
    id: lens.id,
    label: spec.label,
    subject: spec.subject ?? spec.label,
    action: lens.action,
    ...(lens.property === undefined ? {} : { property: lens.property }),
    indent: spec.indent,
    advanced: spec.advanced,
    ...(audience === undefined ? {} : { audience }),
    ...(locked === undefined ? {} : { locked }),
    cells: roles.map((r) => {
      const allowed = lens.cells.find((c) => c.subject === `role:${r.key}`)?.allowed ?? false;
      const modified =
        audience !== undefined && was !== undefined && hasRole(audience, r.key) !== hasRole(was, r.key);
      return { role: r.key, allowed, modified };
    }),
  };
}

const NOT_AVAILABLE: PermissionModel = { available: false, roles: [], sections: [] };

export function buildPermissionModel(doc: Doc, type: string, locale: string, t: Translate): PermissionModel {
  const matrix = buildMatrix(doc, locale);
  const roles = matrix.columns.map((c) => ({ key: c.key, label: c.label }));
  if (!matrix.available) return { ...NOT_AVAILABLE, roles };
  const lens = matrix.types.find((x) => x.key === type);
  if (lens === undefined) return { ...NOT_AVAILABLE, roles };
  const typeRow = (action: TypeAction, label: string, advanced: boolean): MatrixRowModel[] => {
    const r = lens.rows.find((x) => x.action === action);
    return r === undefined ? [] : [rowModel({ lens: r, label, indent: 0, advanced }, doc, type, roles)];
  };
  const properties = Object.keys(doc.effective().types?.[type]?.properties ?? {});
  const fieldRows = properties.flatMap((key) => {
    const read = lens.propertyRows.find((x) => x.action === 'see' && x.property === key);
    const write = lens.propertyRows.find((x) => x.action === 'write' && x.property === key);
    const name = labelOf(doc.effective().types?.[type]?.properties[key]?.label, locale, key);
    const spec = (row: Row, label: string, indent: 0 | 1): RowSpec => ({
      lens: row,
      label,
      subject: name,
      indent,
      advanced: false,
    });
    return [
      ...(read === undefined ? [] : [rowModel(spec(read, name, 0), doc, type, roles)]),
      ...(write === undefined
        ? []
        : [rowModel(spec(write, t('matrix_row_field_write'), 1), doc, type, roles)]),
    ];
  });
  const sections: MatrixSectionModel[] = [
    {
      id: 'visibility',
      label: t('matrix_section_visibility'),
      bands: [
        {
          id: 'type',
          label: t('matrix_band_type'),
          advanced: false,
          rows: typeRow('see', t('matrix_row_see'), false),
        },
      ],
    },
    {
      id: 'capabilities',
      label: t('matrix_section_capabilities'),
      bands: [
        {
          id: 'objects',
          label: t('matrix_band_objects'),
          advanced: true,
          rows: [
            ...typeRow('create', t('matrix_row_create'), true),
            ...typeRow('delete', t('matrix_row_delete'), true),
          ],
        },
      ],
    },
  ];
  if (fieldRows.length > 0) {
    sections.push({
      id: 'fields',
      label: t('matrix_section_fields'),
      bands: [{ id: 'data', label: t('matrix_default_tab'), advanced: false, rows: fieldRows }],
    });
  }
  return { available: true, roles, sections };
}
