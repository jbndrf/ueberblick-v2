import { json, type RequestHandler } from '@sveltejs/kit';
import { runTableCall } from './tables.server';
import { TABLE_ACTIONS, type TableCall, type TableErrorCode } from '../../../../../../lib/admin/tables/types';
import { authorizeAdmin } from '../../../../../../lib/server/authz';
import { adminMessage, type AdminKey } from '../../../shell/messages';
import { LOCALE_COOKIE, resolveLocale } from '../../../shell/locale';

const REFUSAL: Record<TableErrorCode, AdminKey> = {
  name_empty: 'tbl_err_name_empty',
  bad_key: 'tbl_err_bad_key',
  key_exists: 'tbl_err_key_exists',
  unknown_table: 'tbl_err_unknown_table',
  column_empty: 'tbl_err_column_empty',
  column_exists: 'tbl_err_column_exists',
  problem: 'tbl_err_problem',
  refused: 'tbl_err_refused',
  no_version: 'tbl_err_no_version',
  conflict: 'tbl_err_conflict',
};
const WITH_DETAIL: readonly TableErrorCode[] = ['problem', 'refused', 'column_exists'];

const isCall = (b: unknown): b is TableCall =>
  typeof b === 'object' &&
  b !== null &&
  typeof (b as { action?: unknown }).action === 'string' &&
  TABLE_ACTIONS.has((b as { action: string }).action);

/**
 * v3's `create`, `update`, `delete` actions of `custom-tables/+page.server.ts` and the column actions of
 * `[tableId]/+page.server.ts`, as one admin route: a table and its columns are part of the project file, so each call is
 * a Doc edit on the draft. The refusal comes in both page languages, as on the Rollen and Beziehungen pages.
 */
export const POST: RequestHandler = async ({ request, params, locals, cookies }) => {
  const auth = authorizeAdmin(locals.admin, params.projectId ?? '');
  if (auth instanceof Response) return auth;
  if (request.headers.get('sec-fetch-site') !== 'same-origin')
    return json({ error: 'A change must come from the admin app (same origin).' }, { status: 403 });
  const body: unknown = await request.json().catch(() => null);
  if (!isCall(body)) return json({ error: 'Expected { action, … }.' }, { status: 400 });
  const locale = resolveLocale(cookies.get(LOCALE_COOKIE), request.headers.get('accept-language'));
  const r = runTableCall(auth.projectKey, auth.principal, locale, body);
  if (r.ok) return json(r.body, { status: body.action === 'create' ? 201 : 200 });
  const key = REFUSAL[r.code];
  const detail = r.detail && WITH_DETAIL.includes(r.code) ? `: ${r.detail}` : '';
  return json(
    {
      error: r.code,
      message: { de: adminMessage('de', key) + detail, en: adminMessage('en', key) + detail },
    },
    { status: r.code === 'conflict' ? 409 : 400 },
  );
};
