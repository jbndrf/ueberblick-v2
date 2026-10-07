/** Import: file -> rows -> runs of the creating task -> `Store` (R3). See contract.ts for the rules. */
import {
  CREATE_TASK,
  GEO_SOURCE_CRS,
  IMPORT_TASK,
  type GeoSourceCrs,
  type Json,
  type Key,
  type Run,
} from '@ueberblick/core';
import type { Store } from '../store';
import { coerce } from './coerce';
import type {
  FieldMapping,
  ImportDeps,
  ImportMapping,
  ImportOptions,
  ImportOutcome,
  ImportPlan,
  ImportProblem,
  ImportRow,
  ImportSource,
  ReadResult,
} from './contract';
import { ImportFileError } from './errors';
import { prepareGeometry } from './geometry';
import { readCsv } from './read-csv';
import { readGeoJson } from './read-geojson';
import { readGeoPackage } from './read-gpkg';
import type { ImportProblemCode } from './registry';

/** In `atomic` mode reading stops after this many problems: the answer is "refused" whatever follows. */
export const ATOMIC_PROBLEM_LIMIT = 1000;

const column = (m: FieldMapping): string => (typeof m === 'string' ? m : m.column);
const language = (m: FieldMapping): string | undefined => (typeof m === 'string' ? undefined : m.language);
const fileProblem = (code: ImportProblemCode, message: string): ImportProblem => ({ row: 0, code, message });

/** Read the file lazily. Throws `ImportFileError` when it is not a file of its format. */
export function readSource(source: ImportSource, mapping: ImportMapping): ReadResult {
  if ('path' in source) return readGeoPackage(source, mapping);
  switch (source.format) {
    case 'csv':
      return readCsv(source.data, mapping);
    case 'geojson':
      return readGeoJson(source.data);
    case 'geopackage':
      return readGeoPackage(source, mapping);
  }
}

/**
 * The one place that decides how a row becomes a run (R1): a Tabelle's rows are `$create` runs of the mapping's `type`
 * (the admin's way to add a row, WP-433), every other import goes through the task that `creates` the type.
 */
export function creationOf(
  mapping: ImportMapping,
  config: ImportDeps['config'],
): {
  readonly typeKey: Key | undefined;
  readonly table: boolean;
  readonly form: Readonly<Record<string, unknown>>;
} {
  if (mapping.task === CREATE_TASK) {
    const type = mapping.type === undefined ? undefined : config.file.types?.[mapping.type];
    return {
      typeKey: type === undefined ? undefined : mapping.type,
      table: true,
      form: type?.properties ?? {},
    };
  }
  const task = config.file.tasks?.[mapping.task];
  return { typeKey: task?.creates as Key | undefined, table: false, form: task?.form ?? {} };
}

/** What the mapping needs from the config: the created type's properties and the geometry field. */
function checkMapping(mapping: ImportMapping, deps: ImportDeps) {
  const { typeKey, table, form } = creationOf(mapping, deps.config);
  const type = typeKey === undefined ? undefined : deps.config.file.types?.[typeKey];
  const problems: ImportProblem[] = [];
  if (type === undefined) {
    problems.push(
      fileProblem(
        'mapping_invalid',
        table
          ? `"${String(mapping.type)}" is not a type`
          : `"${mapping.task}" is not a task that creates a feature`,
      ),
    );
    return { problems };
  }
  if (table && mapping.geometry !== undefined) {
    problems.push(fileProblem('mapping_invalid', 'a Tabelle has no geometry'));
    return { problems };
  }
  const properties = type.properties ?? {};
  for (const [field, m] of Object.entries(mapping.fields)) {
    const p = properties[field];
    if (!(field in form) || p === undefined) {
      problems.push(
        fileProblem(
          'mapping_invalid',
          table
            ? `"${field}" is not a property of "${typeKey}"`
            : `"${field}" is not a form field of task "${mapping.task}"`,
        ),
      );
    } else if (p.type === 'localized_text' && language(m) === undefined) {
      problems.push(fileProblem('mapping_invalid', `"${field}" is a localized text: name a language`));
    }
  }
  const geometryField = table ? undefined : (mapping.geometry?.field ?? type.geometry);
  if (geometryField !== undefined && !(geometryField in form)) {
    problems.push(
      fileProblem('mapping_invalid', `"${geometryField}" is not a form field of task "${mapping.task}"`),
    );
  }
  return {
    problems,
    properties,
    table,
    typeKey,
    geometryField,
    geometryKind: geometryField ? properties[geometryField]?.geometry_type : undefined,
  };
}

/**
 * Rows already read -> runs. The seam WP-301 uses. `declaredCrs` is what the source says about itself; the mapping's
 * `sourceCrs` wins when both are given. Reading stops early in `atomic` mode once the answer is "refused".
 */
export function planRows(
  rows: Iterable<ImportRow>,
  mapping: ImportMapping,
  deps: ImportDeps,
  options: ImportOptions & { readonly declaredCrs?: GeoSourceCrs } = {},
): ImportPlan {
  const mode = options.mode ?? 'atomic';
  const checked = checkMapping(mapping, deps);
  if (checked.problems.length > 0 || checked.properties === undefined)
    return { runs: [], rows: [], problems: checked.problems };
  const crs = mapping.sourceCrs ?? options.declaredCrs;
  if (crs !== undefined && !GEO_SOURCE_CRS.has(crs)) {
    return {
      runs: [],
      rows: [],
      problems: [fileProblem('crs_unsupported', `${String(crs)} cannot be reprojected`)],
    };
  }
  const runs: Run[] = [];
  const rowOf: number[] = [];
  const problems: ImportProblem[] = [];
  const entries = Object.entries(mapping.fields);
  const constants: Record<string, Json> = {};
  // A role constant names a role by key or label, as a role column does; an unknown role refuses the whole file.
  for (const [key, raw] of Object.entries(mapping.constants ?? {})) {
    const prop = checked.properties[key];
    if (prop?.type !== 'role') {
      constants[key] = raw;
      continue;
    }
    const c = coerce('role', raw, {
      ...(deps.config.file.roles === undefined ? {} : { roles: deps.config.file.roles }),
      ...(prop.cardinality === undefined ? {} : { cardinality: prop.cardinality }),
    });
    if (!c.ok) {
      return {
        runs: [],
        rows: [],
        problems: [fileProblem('mapping_invalid', `constant "${key}": ${c.message}`)],
      };
    }
    if (c.value !== undefined) constants[key] = c.value;
  }
  const withConstants = Object.keys(constants).length > 0;
  const problem = (row: number, code: ImportProblemCode, message: string, path?: string): void => {
    problems.push({ row, code, message, ...(path ? { path } : {}) });
  };

  for (const r of rows) {
    const before = problems.length;
    if (r.problem) problem(r.row, r.problem.code, r.problem.message);
    const input: Record<string, Json> = {};
    if (r.problem === undefined) {
      for (const [field, m] of entries) {
        const raw = r.values[column(m).normalize('NFC')] ?? r.values[column(m)];
        const prop = checked.properties[field];
        const c = coerce(prop?.type ?? 'text', raw, {
          ...(language(m) === undefined ? {} : { language: language(m) as string }),
          ...(deps.config.file.roles === undefined ? {} : { roles: deps.config.file.roles }),
          ...(prop?.cardinality === undefined ? {} : { cardinality: prop.cardinality }),
        });
        if (!c.ok) problem(r.row, 'row_malformed', `"${column(m)}": ${c.message}`, field);
        else if (c.value !== undefined) input[field] = c.value;
      }
      if (r.geometry !== undefined && checked.geometryField !== undefined) {
        if (crs === undefined) {
          return {
            runs: [],
            rows: [],
            problems: [
              {
                row: 0,
                code: 'crs_undeclared',
                message: 'the file does not say its coordinate system: give sourceCrs',
              },
            ],
          };
        }
        const g = prepareGeometry(deps.geo, r.geometry, { sourceCrs: crs, kind: checked.geometryKind });
        if ('message' in g) problem(r.row, 'geometry_invalid', g.message, checked.geometryField);
        else input[checked.geometryField] = g.geometry as unknown as Json;
      }
    }
    if (problems.length === before) {
      runs.push({
        id: deps.ids.runId(),
        ...(checked.table
          ? {
              task: CREATE_TASK as Key,
              input: { type: checked.typeKey as Key, values: { ...input, ...constants } },
            }
          : withConstants
            ? { task: IMPORT_TASK as Key, input: { task: mapping.task, values: input, constants } }
            : { task: mapping.task, input }),
        // `$create` is the admin's task and only the admin actor may start it; the id still names the import.
        actor: checked.table ? { ...deps.actor, kind: 'admin' } : deps.actor,
        configVersion: deps.configVersion,
        ...(deps.clientTime !== undefined ? { clientTime: deps.clientTime } : {}),
      });
      rowOf.push(r.row);
    } else if (mode === 'atomic' && problems.length >= ATOMIC_PROBLEM_LIMIT) break;
  }
  return mode === 'atomic' && problems.length > 0
    ? { runs: [], rows: [], problems }
    : { runs, rows: rowOf, problems };
}

/** `planImport(file, mapping)`: read the file and plan its rows. Never throws for a bad file: it is a problem. */
export function planImport(
  source: ImportSource,
  mapping: ImportMapping,
  deps: ImportDeps,
  options: ImportOptions = {},
): ImportPlan {
  let read: ReadResult | undefined;
  try {
    read = readSource(source, mapping);
    return planRows(read.rows, mapping, deps, {
      ...options,
      ...(read.declaredCrs ? { declaredCrs: read.declaredCrs } : {}),
    });
  } catch (e) {
    if (e instanceof ImportFileError)
      return { runs: [], rows: [], problems: [fileProblem('file_unreadable', e.message)] };
    throw e;
  } finally {
    read?.dispose?.();
  }
}

/** Submitted per step in `skip` mode; a step is where a caller may yield (WP-363, bench-chosen). */
export const IMPORT_BATCH = 100;

export interface SubmitOptions extends ImportOptions {
  /** Runs submitted first, in the same transaction (`atomic`): the retirement of a replace. Their refusals have row 0. */
  readonly before?: readonly Run[];
  readonly batchSize?: number;
}

/**
 * Submits a plan through the store, one step at a time; each step yields the rows done so far and the generator's
 * result is the outcome. `atomic`: one `submitBatch` (`before` and the runs), a single step. `skip`: one `submit` per
 * run, `batchSize` runs per step. A caller that must stay responsive yields between steps.
 */
export function* submitPlan(
  store: Store,
  plan: ImportPlan,
  options: SubmitOptions = {},
): Generator<number, ImportOutcome> {
  const mode = options.mode ?? 'atomic';
  const before = options.before ?? [];
  if (plan.problems.some((p) => p.row === 0)) return { outcome: 'refused', problems: plan.problems };
  if (plan.runs.length === 0 && plan.problems.length > 0)
    return { outcome: 'refused', problems: plan.problems };
  if (mode === 'atomic') {
    if (plan.runs.length === 0 && before.length === 0)
      return { outcome: 'accepted', imported: 0, problems: [] };
    const r = store.submitBatch([...before, ...plan.runs]);
    if (r.outcome === 'refused') {
      const { code, message, path } = r.refusal;
      return {
        outcome: 'refused',
        problems: [
          { row: plan.rows[r.index - before.length] ?? 0, code, message, ...(path ? { path } : {}) },
        ],
      };
    }
    yield plan.runs.length;
    return { outcome: 'accepted', imported: plan.runs.length, problems: [] };
  }
  const problems = [...plan.problems];
  const size = options.batchSize ?? IMPORT_BATCH;
  let imported = 0;
  for (let from = 0; from < plan.runs.length; from += size) {
    plan.runs.slice(from, from + size).forEach((run, i) => {
      const r = store.submit(run);
      if (r.outcome === 'accepted') imported++;
      else
        problems.push({
          row: plan.rows[from + i] ?? 0,
          code: r.refusal.code,
          message: r.refusal.message,
          ...(r.refusal.path ? { path: r.refusal.path } : {}),
        });
    });
    yield Math.min(from + size, plan.runs.length);
  }
  return { outcome: 'accepted', imported, problems: problems.sort((a, b) => a.row - b.row) };
}

/** Plan and submit through the store. `atomic`: one `submitBatch`. `skip`: one `submit` per run. */
export function importFile(
  store: Store,
  source: ImportSource,
  mapping: ImportMapping,
  deps: ImportDeps,
  options: ImportOptions = {},
): ImportOutcome {
  const steps = submitPlan(store, planImport(source, mapping, deps, options), options);
  for (let r = steps.next(); ; r = steps.next()) if (r.done) return r.value;
}
