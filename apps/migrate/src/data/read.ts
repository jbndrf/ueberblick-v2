/**
 * Reads a parsed v3 data export into the neutral model of `types.ts`: checks its shape and reports the place of a
 * problem. This is the only file that spells the v3 key names (like `config/read-parts.ts` for the configuration).
 */
import { V3_SYSTEM_FIELDS, type V3SystemField } from './registry';
import type { V3DataExport, V3InstanceRecord, V3LogRow, V3TableRecord, V3UserRecord } from './types';

export class DataExportError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'DataExportError';
  }
}

/** The v3 key names of the data export. */
const K = {
  tableRows: 'table_rows',
  createdAt: 'created_at',
  createdBy: 'created_by',
  observedAt: 'phenomenon_time',
  recordedAt: 'recorded_at',
  run: 'submission_id', // glossary-lint-ignore
} as const;

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

function str(r: Rec, key: string, path: string, required: boolean): string | undefined {
  const v = r[key];
  if (v === undefined || v === null) {
    if (required) throw new DataExportError(`${path}.${key}`, 'is required');
    return undefined;
  }
  if (typeof v !== 'string' || v === '') throw new DataExportError(`${path}.${key}`, 'must be a text');
  return v;
}

const opt = <N extends string>(name: N, v: string | undefined): { [P in N]?: string } =>
  v === undefined ? {} : ({ [name]: v } as { [P in N]?: string });

function logRow(x: unknown, path: string): V3LogRow {
  if (!isRec(x)) throw new DataExportError(path, 'must be an object');
  const field = str(x, 'field', path, false);
  const system = str(x, 'system', path, false);
  if ((field === undefined) === (system === undefined))
    throw new DataExportError(path, 'needs exactly one of "field" and "system"');
  if (system !== undefined && !V3_SYSTEM_FIELDS.has(system))
    throw new DataExportError(`${path}.system`, `"${system}" is not a system field`);
  return {
    ...(field !== undefined ? { field } : {}),
    ...(system !== undefined ? { system: system as V3SystemField } : {}),
    value: x['value'] ?? null,
    ...opt('observer', str(x, 'observer', path, false)),
    ...opt('observedAt', str(x, K.observedAt, path, false)),
    recordedAt: str(x, K.recordedAt, path, true) as string,
    run: str(x, K.run, path, true) as string,
  };
}

function instance(x: unknown, path: string): V3InstanceRecord {
  if (!isRec(x)) throw new DataExportError(path, 'must be an object');
  const log = x['log'] ?? [];
  if (!Array.isArray(log)) throw new DataExportError(`${path}.log`, 'must be a list');
  return {
    id: str(x, 'id', path, true) as string,
    workflow: str(x, 'workflow', path, true) as string,
    ...opt('status', str(x, 'status', path, false)),
    ...opt('stage', str(x, 'stage', path, false)),
    ...opt('createdBy', str(x, K.createdBy, path, false)),
    ...opt('createdAt', str(x, K.createdAt, path, false)),
    ...(x['geometry'] !== undefined && x['geometry'] !== null ? { geometry: x['geometry'] } : {}),
    ...(x['centroid'] !== undefined && x['centroid'] !== null ? { centroid: x['centroid'] } : {}),
    log: log.map((r, i) => logRow(r, `${path}.log.${i}`)),
  };
}

function user(x: unknown, path: string): V3UserRecord {
  if (!isRec(x)) throw new DataExportError(path, 'must be an object');
  const roles = x['roles'] ?? [];
  if (!Array.isArray(roles) || roles.some((r) => typeof r !== 'string' || r === ''))
    throw new DataExportError(`${path}.roles`, 'must be a list of role keys');
  return { id: str(x, 'id', path, true) as string, roles: roles as string[] };
}

function tableRow(x: unknown, path: string): V3TableRecord {
  if (!isRec(x)) throw new DataExportError(path, 'must be an object');
  const values = x['values'] ?? {};
  if (!isRec(values)) throw new DataExportError(`${path}.values`, 'must be an object');
  return {
    id: str(x, 'id', path, true) as string,
    table: str(x, 'table', path, true) as string,
    ...opt('createdAt', str(x, K.createdAt, path, false)),
    values: values as V3TableRecord['values'],
  };
}

/** Throws `DataExportError` (with the place) when the export is not `format: 1`, or a record is malformed. */
export function readDataExport(x: unknown): V3DataExport {
  if (!isRec(x) || x['format'] !== 1) throw new DataExportError('format', 'must be 1');
  const list = (key: string): readonly unknown[] => {
    const v = x[key] ?? [];
    if (!Array.isArray(v)) throw new DataExportError(key, 'must be a list');
    return v;
  };
  const instances = list('instances').map((r, i) => instance(r, `instances.${i}`));
  const tableRows = list(K.tableRows).map((r, i) => tableRow(r, `${K.tableRows}.${i}`));
  const users = list('users').map((r, i) => user(r, `users.${i}`));
  const seenUsers = new Set<string>();
  for (const u of users) {
    if (seenUsers.has(u.id)) throw new DataExportError('users', `"${u.id}" occurs twice`);
    seenUsers.add(u.id);
  }
  const seen = new Set<string>();
  for (const id of [...instances.map((i) => i.id), ...tableRows.map((r) => r.id)]) {
    if (seen.has(id)) throw new DataExportError('id', `"${id}" occurs twice`);
    seen.add(id);
  }
  return { format: 1, users, instances, tableRows };
}

/** A v3 timestamp (`2026-03-04 10:11:12.345Z` or ISO) as an ISO instant, or `undefined` when unreadable. */
export function toInstant(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  const iso = /^\d{4}-\d{2}-\d{2} /.test(s) ? s.replace(' ', 'T') : s;
  const withZone = /(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`;
  const ms = Date.parse(withZone);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}
