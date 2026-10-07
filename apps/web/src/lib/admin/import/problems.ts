/** How the wizard words the dry run's problems and preview rows (pure). The checks themselves are the server's (R1). */
import type { AdminKey } from '../../../routes/(admin)/admin/shell/messages';
import type { PreviewRow } from './import-client';

/** Import problem codes (the server's `IMPORT_PROBLEM_CODES` and `crs_undeclared`) and their messages. */
const PROBLEM_KEYS: Readonly<Record<string, AdminKey>> = {
  file_unreadable: 'import_problem_file_unreadable',
  row_malformed: 'import_problem_row_malformed',
  geometry_invalid: 'import_problem_geometry_invalid',
  crs_unsupported: 'import_problem_crs_unsupported',
  crs_undeclared: 'import_problem_crs_undeclared',
  mapping_invalid: 'import_problem_mapping_invalid',
};

/** The message of a code; null for a code the wizard has no words for (a refusal of plan): the server's text shows. */
export const problemKey = (code: string): AdminKey | null => PROBLEM_KEYS[code] ?? null;

const isPoint = (v: object): v is { type: 'Point'; coordinates: [number, number] } =>
  (v as { type?: unknown }).type === 'Point' && Array.isArray((v as { coordinates?: unknown }).coordinates);

/** One preview cell. `yes` and `no` are the admin's words for booleans. */
export function formatValue(v: unknown, yes = 'Ja', no = 'Nein'): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? yes : no;
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map((x) => formatValue(x, yes, no)).join(', ');
  if (typeof v === 'object' && isPoint(v)) {
    const [x, y] = v.coordinates;
    return `${x.toFixed(5)}, ${y.toFixed(5)}`;
  }
  return JSON.stringify(v);
}

export function previewColumns(
  rows: readonly PreviewRow[],
  labels: Readonly<Record<string, string>>,
): { key: string; label: string }[] {
  const keys: string[] = [];
  for (const r of rows) for (const k of Object.keys(r.values)) if (!keys.includes(k)) keys.push(k);
  return keys.map((key) => ({ key, label: labels[key] ?? key }));
}
