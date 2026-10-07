/**
 * CSV of one Objektart, the columns of the data page (WP-384): the type's properties (geometry is the `lon` and `lat`
 * of the anchor), the id and the system columns. The rows come from the data page's own query (`listFeatures`, R1)
 * page by page, so the file is produced as it is read. v3's format (`project-archive.ts` `csvEscape`): comma, quotes
 * only where needed, a value that is not a string as JSON. A BOM leads, so German Excel reads the umlauts.
 */
import type { Json } from '@ueberblick/core';
import type { Db } from '../../db/driver';
import { columnsOf, listFeatures, parseQuery, type FeatureRowOut } from '../admin-features';
import type { TemplateFile } from '@ueberblick/core';

type TypeDef = NonNullable<TemplateFile['types']>[string];

const BOM = '﻿';
const PAGE = 500;

export function csvCell(value: Json | undefined): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The query error (a message) or the CSV of `type`, as chunks of text. `lifecycle` is the data page's parameter. */
export function csvOfType(
  db: Db,
  type: string,
  def: TypeDef,
  lifecycle: string | null,
):
  | { readonly ok: true; readonly chunks: () => AsyncGenerator<string> }
  | { readonly ok: false; readonly message: string } {
  const cols = columnsOf(def);
  const params = new URLSearchParams({ type, limit: String(PAGE) });
  if (lifecycle !== null) params.set('lifecycle', lifecycle);
  const first = parseQuery(params, 'list', cols);
  if (!first.ok) return { ok: false, message: first.message };
  const keys = [...cols.columns.keys(), 'lon', 'lat'];
  return {
    ok: true,
    chunks: async function* () {
      yield `${BOM}${keys.map(csvCell).join(',')}\n`;
      let cursor: string | null = null;
      do {
        const next = new URLSearchParams(params);
        if (cursor !== null) next.set('cursor', cursor);
        const q = parseQuery(next, 'list', cols);
        if (!q.ok) throw new Error(q.message);
        const page = listFeatures(db, q.query, cols);
        yield page.rows.map((r: FeatureRowOut) => `${keys.map((k) => csvCell(r[k])).join(',')}\n`).join('');
        cursor = page.next;
        await Promise.resolve(); // let a run commit between pages
      } while (cursor !== null);
    },
  };
}
