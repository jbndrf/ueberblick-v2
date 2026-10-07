/**
 * The Tabellen pages' writes (v3 `custom-tables/+page.server.ts` actions and `[tableId]/+page.server.ts` column
 * actions): a table and its columns are config, so each call is a builder Doc op on the project's draft
 * (`table-ops.ts`) and the publish bar picks it up (Q16, WP-326). Rows are not here: they are runs through the admin
 * features API.
 */
import { createDraftStore, draftSources, ensureDraft, type Principal } from '@ueberblick/server';
import { openProject, type Doc } from '@ueberblick/builder';
import { runtime } from '../../../../../../lib/server/runtime';
import type { TableCall, TableErrorCode } from '../../../../../../lib/admin/tables/types';
import { createTable, deleteTable, saveColumns, updateTable, type TableEdit } from './table-ops';

export type TableCallResult =
  | { readonly ok: true; readonly body: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly code: TableErrorCode; readonly detail?: string };

function edit(doc: Doc, call: TableCall, locale: string): TableEdit {
  switch (call.action) {
    case 'create':
      return createTable(doc, call, locale);
    case 'update':
      return updateTable(doc, call.table, call, locale);
    case 'delete':
      return deleteTable(doc, call.table);
    case 'columns':
      return saveColumns(doc, call.table, call.columns, locale);
  }
}

/** One edit of the pages: create, update or delete a table, or save its list of columns. */
export function runTableCall(
  projectKey: string,
  principal: Principal,
  locale: string,
  call: TableCall,
): TableCallResult {
  const by = principal.id;
  const rt = runtime();
  const ensured = ensureDraft(rt.projectDb(projectKey), rt.clock, by);
  const sources = ensured.ok ? draftSources(ensured.draft, rt.templates) : null;
  if (!ensured.ok || !sources) return { ok: false, code: 'no_version' };
  const doc = openProject(sources.templateSrc, sources.overlaySrc);
  const r = edit(doc, call, locale);
  if (!r.ok) return { ok: false, code: r.code, ...(r.detail ? { detail: r.detail } : {}) };
  if (r.doc !== doc) {
    const saved = createDraftStore(rt.projectDb(projectKey)).putIf(
      ensured.draft.revision,
      r.doc.save().overlaySrc,
      by,
      rt.clock.now(),
    );
    if (!saved.ok) return { ok: false, code: 'conflict' };
    rt.previews.schedulePreviewRefresh(projectKey);
  }
  return { ok: true, body: r.key === undefined ? {} : { key: r.key } };
}
