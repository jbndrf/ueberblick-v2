/**
 * The new Objektart of an imported file (v3 `importCollection`, `feature-store/import.ts:77-190`): a type with one
 * property per column and a geometry property, plus the task that creates it, because an import is runs of a creating
 * task (WP-363, R3). v3's shell had no task and nobody could use it until decorated; here the task is `on: $none`
 * (offered nowhere), `who` is `admin` + `import` (an import without it is refused, C-005) and the type has no `permissions`, so no participant sees or creates it until the admin decides.
 * Pure: the result is what the draft's overlay receives (`add types.<key>`, `add tasks.<task>`).
 */
import { WHO_ADMIN, WHO_IMPORT } from '../perms/who';
import type { GeometryTypeKey } from '../registry/schema-enums';
import { IMPORT_COLUMN_TYPES, type ImportColumnType } from './column-types';
import type { FeatureCollectionLike } from './infer';

const UMLAUTS: Readonly<Record<string, string>> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

/** A key (`^[a-z][a-z0-9_]*$`) from a name, unique among `taken`; `fallback` when the name has no usable character. */
export function keyFromName(name: string, taken: readonly string[], fallback: string): string {
  let base = name
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => UMLAUTS[c] ?? c)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (base === '') base = fallback;
  else if (!/^[a-z]/.test(base)) base = `t_${base}`;
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}_${n}`)) return `${base}_${n}`;
}

export interface ImportedColumn {
  readonly name: string;
  readonly type: ImportColumnType;
}

export interface ImportedTypeInput {
  readonly name: string;
  /** The geometry kind of the file, null when no feature has one. */
  readonly geometry: GeometryTypeKey | null;
  readonly columns: readonly ImportedColumn[];
}

export interface ImportedType {
  readonly taskKey: string;
  /** The entry for `types.<key>` of the draft. */
  readonly type: Record<string, unknown>;
  /** The entry for `tasks.<taskKey>` of the draft. */
  readonly task: Record<string, unknown>;
  /** The import mapping (WP-363): form field key to file column, and the geometry field. */
  readonly mapping: {
    readonly task: string;
    readonly fields: Readonly<Record<string, string>>;
    readonly geometry?: { readonly field: string };
  };
}

const GEOMETRY_KEY = 'geometrie';

/** `typeKey` is already unique; `takenTasks` are the task keys of the draft. */
export function importedType(
  input: ImportedTypeInput,
  typeKey: string,
  takenTasks: readonly string[],
): ImportedType {
  const taskKey = keyFromName(`${typeKey}_import`, takenTasks, 'import');
  const properties: Record<string, unknown> = {};
  const form: Record<string, unknown> = {};
  const fields: Record<string, string> = {};
  const taken: string[] = [];
  if (input.geometry !== null) {
    taken.push(GEOMETRY_KEY);
    properties[GEOMETRY_KEY] = { type: 'geometry', geometry_type: input.geometry };
    form[GEOMETRY_KEY] = {};
  }
  for (const column of input.columns) {
    const key = keyFromName(column.name, taken, 'eigenschaft');
    taken.push(key);
    const entry = IMPORT_COLUMN_TYPES.get(column.type);
    // The label is the column name verbatim: v3 mirrored the source 1:1 (`import.ts:140`).
    properties[key] = { type: entry.property, label: column.name };
    form[key] = column.type === 'long_text' ? { appearance: 'multiline' } : {};
    fields[key] = column.name;
  }
  return {
    taskKey,
    type: {
      label: input.name,
      ...(input.geometry === null ? {} : { geometry: GEOMETRY_KEY }),
      properties,
    },
    task: { label: input.name, on: '$none', creates: typeKey, form, who: [WHO_ADMIN, WHO_IMPORT] },
    mapping: {
      task: taskKey,
      fields,
      ...(input.geometry === null ? {} : { geometry: { field: GEOMETRY_KEY } }),
    },
  };
}

/**
 * The file as the import should read it: a value of a text column that is not text (a number, a boolean, a nested
 * object) becomes text, so an override to text (v3 `typeOverrides`) mirrors the source instead of failing the row.
 * The same collection comes back when nothing changes.
 */
export function stringifyForText(
  collection: FeatureCollectionLike,
  types: Readonly<Record<string, ImportColumnType>>,
): FeatureCollectionLike {
  let changed = false;
  const features = collection.features.map((feature) => {
    const props = feature.properties;
    if (props === null || props === undefined) return feature;
    let next: Record<string, unknown> | undefined;
    for (const [key, value] of Object.entries(props)) {
      const type = types[key];
      if ((type !== 'text' && type !== 'long_text') || value === null || value === undefined) continue;
      if (typeof value === 'string') continue;
      next ??= { ...props };
      next[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
    if (next === undefined) return feature;
    changed = true;
    return { ...feature, properties: next };
  });
  return changed ? { ...collection, features } : collection;
}
