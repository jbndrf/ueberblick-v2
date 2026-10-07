/**
 * The data page's Admin-Korrektur (WP-370, owner answer A1): the values of one edited row go out as ONE `$correct`
 * run (`POST features/<id>/correct`, server `correct.ts`). Pure: no DOM; the page passes `fetch` and its texts.
 */
import { SYSTEM_FIELD_SIGIL, type TemplateFile } from '@ueberblick/core';
import { RowRefusal } from '@ueberblick/ui/components/admin';
import type { TableRow } from '@ueberblick/ui/components/admin';
import { localInputToInstant } from '../datetime-input';

type TypeDef = NonNullable<TemplateFile['types']>[string];

export const correctUrl = (project: string, id: string): string =>
  `/api/admin/p/${encodeURIComponent(project)}/features/${encodeURIComponent(id)}/correct`;

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Cell values back to property values: a select cell holds a list of one, an emptied cell clears the property. */
export function correctionValues(type: TypeDef, edited: TableRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(edited)) {
    const kind = type.properties[key]?.type;
    if (isEmpty(value)) out[key] = null;
    else if (kind === 'select') out[key] = Array.isArray(value) ? String(value[0]) : value;
    // A role cell is a list too: one key for a single role, the list for `cardinality: many`.
    else if (kind === 'role')
      out[key] =
        Array.isArray(value) && type.properties[key]?.cardinality !== 'many' ? String(value[0]) : value;
    // A `datetime-local` cell gives the admin's local time (no zone); the property wants an instant.
    else if (kind === 'datetime' && typeof value === 'string') out[key] = localInputToInstant(value) ?? value;
    else out[key] = value;
  }
  return out;
}

export interface CorrectTexts {
  /** The Objekt changed since the table loaded it. */
  readonly stale: string;
  readonly failed: string;
  readonly refused: (property: string, reason: string) => string;
  /** The label of a property (the column header). */
  readonly label: (key: string) => string;
}

interface Issue {
  readonly path: string;
  readonly message: string;
}
const VALUES_PREFIX = 'input.values.';

/** Sends one correction; resolves with the Objekt's new seq, or throws what `onRowSave` of the table understands. */
export async function submitCorrection(
  fetchFn: typeof fetch,
  project: string,
  id: string,
  values: Record<string, unknown>,
  expectedSeq: number | undefined,
  texts: CorrectTexts,
): Promise<number> {
  const res = await fetchFn(correctUrl(project, id), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ values, ...(expectedSeq === undefined ? {} : { expected_seq: expectedSeq }) }),
  });
  if (res.ok) return ((await res.json()) as { seq: number }).seq;
  if (res.status === 409) throw new RowRefusal(texts.stale);
  if (res.status === 422) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; issues?: Issue[] } };
    const issue = body.error?.issues?.find((i) => i.path.startsWith(VALUES_PREFIX));
    const key = issue?.path.slice(VALUES_PREFIX.length);
    const reason = issue?.message ?? body.error?.message ?? texts.failed;
    if (key !== undefined && !key.startsWith(SYSTEM_FIELD_SIGIL))
      throw new RowRefusal(texts.refused(texts.label(key), reason), { [key]: reason });
    throw new RowRefusal(reason);
  }
  throw new Error(`correct failed: ${res.status}`);
}

export interface RowSaverOptions {
  readonly fetch: typeof fetch;
  readonly project: string;
  /** Read at each save, so a type that changed after a publish is the one checked against. */
  readonly type: () => TypeDef;
  readonly texts: CorrectTexts;
  /** The rows the table shows now: the `$seq` of the edited one is what the correction must still find. */
  readonly rows: () => readonly TableRow[];
  /** The run may have changed more than the edited cells (computed values, rules): the row is read again. */
  readonly refresh: (id: string) => Promise<void>;
}

/** `onRowSave` of a table in Bearbeitungsmodus: one row's edits as one `$correct` run (the data page and the Tabellen page). */
export function createRowSaver(o: RowSaverOptions): (rowId: string, edited: TableRow) => Promise<void> {
  return async (rowId, edited) => {
    const seq = o.rows().find((r) => r.id === rowId)?.['$seq'];
    await submitCorrection(
      o.fetch,
      o.project,
      rowId,
      correctionValues(o.type(), edited),
      typeof seq === 'number' ? seq : undefined,
      o.texts,
    );
    await o.refresh(rowId);
  };
}
