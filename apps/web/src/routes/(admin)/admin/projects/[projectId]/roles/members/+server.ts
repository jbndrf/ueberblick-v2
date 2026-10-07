import { json, type RequestHandler } from '@sveltejs/kit';
import { messageOf, setRoleMembers } from '@ueberblick/server';
import { runtime } from '../../../../../../../lib/server/runtime';
import { authorizeAdmin } from '../../../../../../../lib/server/authz';

const ids = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;

/**
 * v3 `updateParticipants` action (`roles/+page.server.ts`): who has one role, as one change set (`{ role, add, remove }`).
 * The roster is not part of the draft (Q13), so it applies at once.
 */
export const PUT: RequestHandler = async ({ request, params, locals }) => {
  const auth = authorizeAdmin(locals.admin, params.projectId ?? '');
  if (auth instanceof Response) return auth;
  if (request.headers.get('sec-fetch-site') !== 'same-origin')
    return json({ error: 'A change must come from the admin app (same origin).' }, { status: 403 });
  const body = (await request.json().catch(() => null)) as {
    role?: unknown;
    add?: unknown;
    remove?: unknown;
  } | null;
  const add = ids(body?.add);
  const remove = ids(body?.remove);
  if (typeof body?.role !== 'string' || !add || !remove)
    return json({ error: 'Expected { role, add: [ids], remove: [ids] }.' }, { status: 400 });
  const rt = runtime();
  const done = setRoleMembers(
    { db: rt.projectDb(auth.projectKey), now: () => new Date(rt.clock.now()), templates: rt.templates },
    body.role,
    { add, remove },
  );
  if (done.ok) return json({ ok: true });
  return json({ error: done.code, message: messageOf(done.code, done.detail) }, { status: 400 });
};
