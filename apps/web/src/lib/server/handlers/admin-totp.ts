import { AUTH_THROTTLED, AUTH_TOTP_REJECTED } from '@ueberblick/server';
import { addressOf, throttle } from '../ratelimit';
import { runtime } from '../runtime';
import { isRecord, json, readJson, type Call } from './http';

/** The signed-in admin's account id, or the refusing response. */
function adminId(call: Call): string | Response {
  const p = call.locals.admin;
  if (p === null) return json({ error: 'Sign in first.' }, 401);
  if (p.kind !== 'admin') return json({ error: 'Admin access required.' }, 403);
  return p.id;
}

/** POST: starts TOTP enrolment for the signed-in admin. Refused (409) while a TOTP is confirmed. */
export function enrol(call: Call): Response {
  const id = adminId(call);
  if (id instanceof Response) return id;
  try {
    const r = runtime().auth.enrolTotp(id);
    return json({ otpauthUri: r.otpauthUri, secret: r.secret }, 200, { 'cache-control': 'no-store' });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('TOTP already enrolled'))
      return json({ error: 'TOTP is already enrolled.' }, 409);
    throw e;
  }
}

/** POST `{ code }`: confirms the pending enrolment with a valid code. */
export async function confirm(call: Call): Promise<Response> {
  const id = adminId(call);
  if (id instanceof Response) return id;
  const body = await readJson(call.request);
  if ('response' in body) return body.response;
  const code = isRecord(body.value) ? body.value['code'] : undefined;
  if (typeof code !== 'string') return json({ error: 'code is required' }, 400);
  const attempt = throttle().attempt('totp', addressOf(call), id);
  if (attempt.refused) {
    runtime().log.log('auth.failed', { code: AUTH_THROTTLED, ip: addressOf(call), actor: id });
    return attempt.refused;
  }
  if (!runtime().auth.verifyTotp(id, code)) {
    attempt.fail();
    runtime().log.log('auth.failed', { code: AUTH_TOTP_REJECTED, ip: addressOf(call), actor: id });
    return json({ error: 'The code was not accepted.' }, 400);
  }
  attempt.succeed();
  return json({ confirmed: true });
}
