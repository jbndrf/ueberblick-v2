/**
 * The wizard's mapping state and the body it sends to WP-363's endpoints (pure). v3 kept `columnMapping` (CSV header ->
 * target id) in the dialog (`csv-import-dialog.svelte:112-180`); the targets here are the creating task's form fields
 * plus the longitude and latitude columns of a point. Only the mapping is built here: no row is checked (R1).
 */
import type { ImportSetup } from './setup';

/** Target ids of the coordinate columns; a form field's key never starts with `$`. */
export const LON = '$lon';
export const LAT = '$lat';

export interface Target {
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
}

export interface ConstantRow {
  readonly key: string;
  readonly value: string;
}

export interface MappingState {
  /** CSV header -> target id; '' (or absent) is 'Überspringen'. */
  readonly columns: Readonly<Record<string, string>>;
  /** The stage every row is created in ('In Stufe importieren'); '' leaves it to the task. */
  readonly stage: string;
  /** 'Wert für alle Zeilen' for other properties. */
  readonly constants: readonly ConstantRow[];
  /** The coordinate system of the longitude and latitude columns. */
  readonly crs: string;
}

/** The body of `mapping` (`ImportMapping` of the server's io contract, as JSON). */
export interface MappingBody {
  readonly task: string;
  /** A Tabelle's key, with `task: '$create'`. */
  readonly type?: string;
  readonly fields: Readonly<Record<string, string | { readonly column: string; readonly language: string }>>;
  readonly constants?: Readonly<Record<string, string | number | boolean>>;
  readonly geometry?: { readonly field: string; readonly x?: string; readonly y?: string };
  readonly sourceCrs?: string;
  readonly delimiter?: string;
}

/** v3: special columns first, then the target fields. */
export function targetsOf(
  setup: ImportSetup,
  labels: { readonly lon: string; readonly lat: string },
): Target[] {
  const coordinates: Target[] =
    setup.geometry?.point === true
      ? [
          { id: LON, label: labels.lon, required: setup.geometry.required },
          { id: LAT, label: labels.lat, required: setup.geometry.required },
        ]
      : [];
  return [...coordinates, ...setup.fields.map((f) => ({ id: f.key, label: f.label, required: f.required }))];
}

const ALIASES: Readonly<Record<string, readonly string[]>> = {
  [LON]: ['lon', 'lng', 'long', 'longitude', 'laengengrad', 'längengrad'],
  [LAT]: ['lat', 'latitude', 'breitengrad'],
};

/** v3 matched a header to a target's label (case-insensitive, once per target); the key and the usual coordinate names count too. */
export function autoMap(headers: readonly string[], targets: readonly Target[]): Record<string, string> {
  const mapped: Record<string, string> = {};
  const used = new Set<string>();
  for (const header of headers) {
    const h = header.toLowerCase().trim();
    const hit = targets.find(
      (t) =>
        !used.has(t.id) &&
        (t.label.toLowerCase().trim() === h || t.id.toLowerCase() === h || ALIASES[t.id]?.includes(h)),
    );
    if (hit !== undefined) {
      mapped[header] = hit.id;
      used.add(hit.id);
    }
  }
  return mapped;
}

export function missingRequired(
  targets: readonly Target[],
  columns: Readonly<Record<string, string>>,
): Target[] {
  const mapped = new Set(Object.values(columns).filter(Boolean));
  return targets.filter((t) => t.required && !mapped.has(t.id));
}

/** A typed value for a constant: the input is text, the property's type decides. */
function typed(kind: string, raw: string): string | number | boolean {
  if (kind === 'boolean') return raw === 'true';
  if (kind === 'number' || kind === 'integer') return Number(raw.trim().replace(',', '.'));
  return raw;
}

export function buildMapping(setup: ImportSetup, state: MappingState, delimiter: string): MappingBody {
  const fields: Record<string, string | { column: string; language: string }> = {};
  let x: string | undefined;
  let y: string | undefined;
  for (const [column, target] of Object.entries(state.columns)) {
    if (target === LON) x = column;
    else if (target === LAT) y = column;
    else if (target !== '') {
      const field = setup.fields.find((f) => f.key === target);
      if (field === undefined) continue;
      fields[target] = field.language === undefined ? column : { column, language: field.language };
    }
  }
  const constants: Record<string, string | number | boolean> = {};
  if (setup.stage !== null && state.stage !== '') constants[setup.stage.property] = state.stage;
  for (const row of state.constants) {
    const def = setup.constants.find((c) => c.key === row.key);
    if (def !== undefined && row.value.trim() !== '') constants[row.key] = typed(def.kind, row.value);
  }
  const geometry =
    setup.geometry !== null && x !== undefined && y !== undefined
      ? { field: setup.geometry.field, x, y }
      : undefined;
  return {
    task: setup.task,
    ...(setup.type === undefined ? {} : { type: setup.type }),
    fields,
    ...(Object.keys(constants).length > 0 ? { constants } : {}),
    ...(geometry === undefined ? {} : { geometry, sourceCrs: state.crs }),
    delimiter,
  };
}
