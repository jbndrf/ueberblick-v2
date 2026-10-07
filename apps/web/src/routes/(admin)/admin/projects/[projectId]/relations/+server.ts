import { json, type RequestHandler } from '@sveltejs/kit';
import {
  ON_DELETE_BEHAVIORS,
  RELATION_ATTACHMENTS,
  RELATION_GEOMETRIES,
  type RelationErrorCode,
} from '@ueberblick/builder';
import { runRelationCall } from './relations.server';
import type { RelationCall } from '../../../../../../lib/admin/relations/types';
import { authorizeAdmin } from '../../../../../../lib/server/authz';
import { adminMessage, type AdminKey } from '../../../shell/messages';
import { LOCALE_COOKIE, resolveLocale } from '../../../shell/locale';

const ACTIONS = ['create', 'update', 'uses', 'delete'] as const;
const REFUSAL: Record<RelationErrorCode, AdminKey> = {
  name_empty: 'rel_err_name_empty',
  same_type: 'rel_err_same_type',
  unknown_type: 'rel_err_unknown_type',
  unknown_relation: 'rel_err_unknown_relation',
  key_clash: 'rel_err_key_clash',
  problem: 'rel_err_problem',
  refused: 'rel_err_refused',
  no_version: 'rel_err_no_version',
  conflict: 'rel_err_conflict',
};

/** An option of the body is absent or one key of its registry (the page sends keys, never free text). */
const validOption = (v: unknown, has: (key: string) => boolean): boolean =>
  v === undefined || (typeof v === 'string' && has(v));

const isCall = (b: unknown): b is RelationCall =>
  typeof b === 'object' &&
  b !== null &&
  ACTIONS.some((a) => (b as { action?: unknown }).action === a) &&
  validOption((b as { attachment?: unknown }).attachment, RELATION_ATTACHMENTS.has) &&
  validOption((b as { onDelete?: unknown }).onDelete, ON_DELETE_BEHAVIORS.has) &&
  validOption((b as { geometry?: unknown }).geometry, RELATION_GEOMETRIES.has);

/**
 * v3 `create`, `update` and `delete` actions of `relations/+page.server.ts`, as one admin route: a relation is part of
 * the project file, so each call is a Doc edit on the draft, and `uses` shows what a deletion would break before it is
 * made. The refusal comes in both page languages, as on the Rollen page.
 */
export const POST: RequestHandler = async ({ request, params, locals, cookies }) => {
  const auth = authorizeAdmin(locals.admin, params.projectId ?? '');
  if (auth instanceof Response) return auth;
  if (request.headers.get('sec-fetch-site') !== 'same-origin')
    return json({ error: 'A change must come from the admin app (same origin).' }, { status: 403 });
  const body: unknown = await request.json().catch(() => null);
  if (!isCall(body)) return json({ error: 'Expected { action, … }.' }, { status: 400 });
  const locale = resolveLocale(cookies.get(LOCALE_COOKIE), request.headers.get('accept-language'));
  const r = runRelationCall(auth.projectKey, auth.principal, locale, body);
  if (r.ok) return json(r.body, { status: body.action === 'create' ? 201 : 200 });
  const key = REFUSAL[r.code];
  const detail = r.detail ? { detail: r.detail } : {};
  return json(
    {
      error: r.code,
      ...detail,
      message: {
        de:
          adminMessage('de', key) +
          ((r.code === 'problem' || r.code === 'key_clash') && r.detail ? `: ${r.detail}` : ''),
        en:
          adminMessage('en', key) +
          ((r.code === 'problem' || r.code === 'key_clash') && r.detail ? `: ${r.detail}` : ''),
      },
    },
    { status: r.code === 'conflict' ? 409 : 400 },
  );
};
