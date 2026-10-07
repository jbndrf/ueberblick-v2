/**
 * The data page header's server side (v3 `?/updateWorkflowMeta`, `W/+page.server.ts:538-603`): the header of the draft
 * for the load, and one call saved to the draft as a builder Doc edit (`header-ops.ts`), the same way the Icons dialog and
 * the Tabellen pages save theirs. The publish bar picks the draft up.
 */
import { fail, type ActionFailure } from '@sveltejs/kit';
import { servedSql, type TemplateFile } from '@ueberblick/core';
import type { Principal } from '@ueberblick/server';
import {
  HEADER_ACTIONS,
  type HeaderCall,
  type HeaderErrorCode,
  type HeaderState,
} from '../../../../../../../lib/admin/data/header-types';
import { runtime } from '../../../../../../../lib/server/runtime';
import { adminMessage, type AdminKey } from '../../../../shell/messages';
import { editDraft } from './edit.server';
import { headerEdit, headerState } from './header-ops';

const REFUSAL: Record<HeaderErrorCode, AdminKey> = {
  name_empty: 'data_name_empty',
  unknown_type: 'data_err_unknown_type',
  locked: 'data_err_locked',
  no_geometry: 'data_err_no_geometry',
  problem: 'data_err_problem',
  refused: 'data_err_refused',
  no_version: 'data_err_no_version',
  conflict: 'data_err_conflict',
};
const WITH_DETAIL: readonly HeaderErrorCode[] = ['problem', 'refused'];

export const isHeaderCall = (b: unknown): b is HeaderCall =>
  typeof b === 'object' && b !== null && HEADER_ACTIONS.has(String((b as { action?: unknown }).action));

/** Objects of the type now (the shape note names them); the same served-set the deploy overview counts. */
export function featureCount(projectKey: string, type: string): number {
  return (
    runtime()
      .projectDb(projectKey)
      .prepare<{ n: number }>(
        `SELECT COUNT(*) AS n FROM features WHERE type = ? AND ${servedSql('lifecycle')}`,
      )
      .get(type)?.n ?? 0
  );
}

/** The header of one type in the draft (or, with no draft yet, the deployed file); null when the project has neither. */
export function loadHeader(
  source: { effective(): TemplateFile } | null,
  projectKey: string,
  type: string,
  locale: string,
): HeaderState | null {
  return source === null || source.effective().types?.[type] === undefined
    ? null
    : headerState(source, type, locale, featureCount(projectKey, type));
}

const message = (code: HeaderErrorCode, detail?: string): { de: string; en: string } => {
  const add = detail !== undefined && WITH_DETAIL.includes(code) ? `: ${detail}` : '';
  return {
    de: adminMessage('de', REFUSAL[code]) + add,
    en: adminMessage('en', REFUSAL[code]) + add,
  };
};

type Outcome =
  | { readonly ok: true; readonly header: HeaderState }
  | { readonly ok: false; readonly code: HeaderErrorCode; readonly detail?: string };

/** One edit of the header, saved to the draft; answers with the header after it. */
export function runHeaderCall(
  projectKey: string,
  principal: Principal,
  locale: string,
  type: string,
  call: HeaderCall,
): Outcome {
  const r = editDraft(projectKey, principal, (doc) => {
    const e = headerEdit(doc, type, call, locale);
    return e.ok ? { ok: true, doc: e.doc, value: undefined } : e;
  });
  if (!r.ok) return r;
  return { ok: true, header: headerState(r.doc, type, locale, featureCount(projectKey, type)) };
}

/** The action's answer: the header after the edit, or the refusal in both page languages. */
export function headerAnswer(
  o: Outcome,
): { header: HeaderState } | ActionFailure<{ message: { de: string; en: string } }> {
  return o.ok
    ? { header: o.header }
    : fail(o.code === 'conflict' ? 409 : 400, { message: message(o.code, o.detail) });
}
