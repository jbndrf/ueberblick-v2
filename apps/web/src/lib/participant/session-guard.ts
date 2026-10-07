/**
 * Keeps an open device from working under another participant's session (WP-768). The device database is per
 * participant, but the cookie is shared by every tab of the browser. The guard names the participant on each run and
 * sync request (the server then refuses a request made as someone else without touching anything) and judges each
 * reply by the participant the server names. On a mismatch it tells the tabs and, from then on, sends nothing: the
 * page reloads into the current session, and the queued runs stay in this participant's own database.
 * It runs in the page and in the sync worker, so it imports no app code.
 */
import { SESSION_PARTICIPANT_HEADER } from '@ueberblick/core/sync';
import type { FetchLike } from './http';
import { announceSessionChanged } from './session-channel';

/** `/api/p/<project>/runs`, `/runs/batch` and `/sync`: the requests that act as, or read for, one participant. */
const GUARDED = /^\/api\/p\/[^/?]+\//;

export class SessionChangedError extends Error {
  constructor() {
    super('The browser session belongs to another participant.');
    this.name = 'SessionChangedError';
  }
}

export function sessionGuard(
  fetch: FetchLike,
  participantId: string,
  announce: () => void = announceSessionChanged,
): FetchLike {
  let foreign = false;
  const stop = (): never => {
    if (!foreign) {
      foreign = true;
      announce();
    }
    throw new SessionChangedError();
  };
  return async (input, init) => {
    if (!GUARDED.test(input)) return fetch(input, init);
    if (foreign) return stop();
    const headers = new Headers(init?.headers);
    headers.set(SESSION_PARTICIPANT_HEADER, participantId);
    const res = await fetch(input, { ...init, headers });
    const named = res.headers.get(SESSION_PARTICIPANT_HEADER);
    if (named !== null && named !== participantId) return stop();
    return res;
  };
}
