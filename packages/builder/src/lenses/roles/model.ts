/**
 * The permission matrix as the lens draws it: subjects (columns) x feature types x actions, with
 * properties one level down. Every cell's *effective* value comes from `core.compilePerms` (R1, decision
 * 0012); this file never interprets an audience. Columns are subjects (`role:<key>`), so teams (O12) can
 * join as more columns without a change of shape.
 */
import {
  compile,
  NO_ASSETS,
  compilePerms,
  roleSubject,
  type Key,
  type Perms,
  type PermAction,
  type Provenance,
  type TemplateFile,
  type TypePerms,
} from '@ueberblick/core';
import type { Doc } from '../../doc';
import { labelOf } from '../../shell/location';

export interface SubjectColumn {
  /** `role:<key>`: the subject `core.perms` works with, and the key of every cell. */
  readonly subject: string;
  readonly key: string;
  readonly label: string;
  readonly path: string;
  readonly provenance: Provenance;
}

export interface Cell {
  readonly subject: string;
  /** What `core.perms` says for this subject (the `see` row: the audience does not hide the row). */
  readonly allowed: boolean;
  /** Allowed only while the type's `visible_when` holds. */
  readonly conditional: boolean;
}

export interface Row {
  /** Unique within the matrix, e.g. `baum.write.hoehe_m`. */
  readonly id: string;
  readonly action: PermAction;
  /** Set on a property row; absent on the whole-type row. */
  readonly property?: string;
  readonly label: string;
  readonly cells: readonly Cell[];
  /** False when the file's value cannot be edited from this cell (see `note`). */
  readonly editable: boolean;
  readonly note?: 'per_property' | 'all_rows_visible';
}

export interface TypeRows {
  readonly key: string;
  readonly path: string;
  readonly label: string;
  /** One row per action for the whole type. */
  readonly rows: readonly Row[];
  /** Property rows for `see` and `write`, in file order. */
  readonly propertyRows: readonly Row[];
  /** True when `see` / `write` are keyed by property in the file. */
  readonly seeByProperty: boolean;
  readonly writeByProperty: boolean;
  readonly visibleWhen?: string;
}

export interface PermissionMatrix {
  /** False when the effective file does not compile: no cell can be called effective then. */
  readonly available: boolean;
  readonly columns: readonly SubjectColumn[];
  readonly types: readonly TypeRows[];
}

/** The actor `core.perms` is asked about: an admin holding exactly one role. */
const probeActor = (role: string) => ({
  id: 'builder-preview',
  kind: 'admin' as const,
  roles: [role as Key],
});
const NOW = '1970-01-01T00:00:00.000Z';
type Ctx = Parameters<TypePerms['canDelete']>[2];

/**
 * `canDelete` needs a feature and a context only to evaluate `visible_when`; against this empty
 * context a `visible_when` is false, which `core.perms` reports as `not_visible`, and that is read as
 * "allowed, conditional" (the audience let the subject through).
 */
const stubCtx = {
  vars: new Map(),
  features: { property: () => undefined, related: () => [], history: () => [], type: () => undefined },
  now: NOW,
  relations: new Map(),
  geo: {},
} as unknown as Ctx;
const stubFeature = { id: 'preview', type: '', properties: {}, lifecycle: 'active', updatedSeq: 0 } as never;

export function columnsOf(file: TemplateFile, doc: Doc, locale: string): SubjectColumn[] {
  return Object.entries(file.roles ?? {}).map(([key, r]) => {
    const path = `roles.${key}`;
    return {
      subject: roleSubject(key),
      key,
      label: labelOf(r.label, locale, key),
      path,
      provenance: doc.provenance(path),
    };
  });
}

type CellValue = Omit<Cell, 'subject'>;
const cells = (columns: readonly SubjectColumn[], f: (role: string, subject: string) => CellValue) =>
  columns.map((c): Cell => ({ subject: c.subject, ...f(c.key, c.subject) }));

function typeRows(
  key: string,
  file: TemplateFile,
  perms: Perms,
  columns: readonly SubjectColumn[],
  locale: string,
): TypeRows | undefined {
  const def = file.types?.[key];
  const tp = perms.forType(key as Key);
  if (def === undefined || tp === undefined) return undefined;
  const p = def.permissions;
  const isMap = (v: unknown): boolean => v !== undefined && typeof v === 'object' && !Array.isArray(v);
  const seeByProperty = isMap(p?.see);
  const writeByProperty = isMap(p?.write);
  const conditional = p?.visible_when !== undefined;
  const props = Object.keys(def.properties);

  const rowVisible = (role: string, s: string): boolean =>
    tp.seeSql([s], probeActor(role), 'f', NOW).kind !== 'none';
  const rows: Row[] = [
    {
      id: `${key}.see`,
      action: 'see',
      label: '',
      editable: !seeByProperty,
      ...(seeByProperty ? { note: 'all_rows_visible' as const } : {}),
      cells: cells(columns, (role, s) => ({ allowed: rowVisible(role, s), conditional })),
    },
    {
      id: `${key}.create`,
      action: 'create',
      label: '',
      editable: true,
      cells: cells(columns, (_r, s) => ({ allowed: tp.canCreate([s]).ok, conditional: false })),
    },
    {
      id: `${key}.write`,
      action: 'write',
      label: '',
      editable: !writeByProperty,
      ...(writeByProperty ? { note: 'per_property' as const } : {}),
      cells: cells(columns, (_r, s) => ({
        allowed: props.length > 0 && tp.canWrite([s], props).ok,
        conditional: false,
      })),
    },
    {
      id: `${key}.delete`,
      action: 'delete',
      label: '',
      editable: true,
      cells: cells(columns, (_r, s) => {
        const d = tp.canDelete([s], stubFeature, stubCtx);
        const allowed = d.ok || d.denial === 'not_visible';
        return { allowed, conditional: conditional && allowed };
      }),
    },
  ];
  const propertyRows: Row[] = [];
  for (const [pk, prop] of Object.entries(def.properties)) {
    const label = labelOf(prop.label, locale, pk);
    propertyRows.push({
      id: `${key}.see.${pk}`,
      action: 'see',
      property: pk,
      label,
      editable: seeByProperty,
      cells: cells(columns, (_r, s) => ({ allowed: tp.readable([s]).has(pk), conditional })),
    });
    propertyRows.push({
      id: `${key}.write.${pk}`,
      action: 'write',
      property: pk,
      label,
      editable: true,
      cells: cells(columns, (_r, s) => ({ allowed: tp.canWrite([s], [pk]).ok, conditional: false })),
    });
  }
  return {
    key,
    path: `types.${key}`,
    label: labelOf(def.label, locale, key),
    rows,
    propertyRows,
    seeByProperty,
    writeByProperty,
    ...(p?.visible_when === undefined ? {} : { visibleWhen: p.visible_when }),
  };
}

export function buildMatrix(doc: Doc, locale: string): PermissionMatrix {
  const file = doc.effective();
  const columns = columnsOf(file, doc, locale);
  const compiled = compile(file, { assets: NO_ASSETS });
  if (!compiled.ok) return { available: false, columns, types: [] };
  let perms: Perms;
  try {
    perms = compilePerms(compiled.config);
  } catch {
    return { available: false, columns, types: [] };
  }
  const types = Object.keys(file.types ?? {}).flatMap((k) => {
    const t = typeRows(k, file, perms, columns, locale);
    return t === undefined ? [] : [t];
  });
  return { available: true, columns, types };
}

/** The permission rows every type has (see, create, write, delete). */
export const ROWS_PER_TYPE = 4;

/**
 * R14: the first render must not be O(types x roles). Types draw their permission boxes while the boxes
 * drawn so far stay within this many; later types start collapsed behind one button.
 */
export const INITIAL_CELLS = 300;

/** Keys of the types that start open: file order, the first always, then while the budget holds. */
export function initiallyOpenTypes(matrix: PermissionMatrix): ReadonlySet<string> {
  const per = ROWS_PER_TYPE * matrix.columns.length;
  const keys = new Set<string>();
  for (const t of matrix.types) {
    if (keys.size > 0 && (keys.size + 1) * per > INITIAL_CELLS) break;
    keys.add(t.key);
  }
  return keys;
}
