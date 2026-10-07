import { json, type Call } from './http';

/** Liveness plus who the server thinks the caller is. */
export function health(call: Call): Response {
  return json({ ok: true, admin: call.locals.admin, participant: call.locals.participant ?? null });
}
