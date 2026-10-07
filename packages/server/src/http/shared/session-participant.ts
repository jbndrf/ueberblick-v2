import { SESSION_CHANGED_CODE, SESSION_PARTICIPANT_HEADER, SYNC_PROTOCOL_VERSION } from '@ueberblick/core';

/**
 * The session participant on the device endpoints (WP-768). Two browser tabs share one session cookie, so a tab that
 * works as olga can find the cookie turned into felix's. The device names the participant it works as in
 * `SESSION_PARTICIPANT_HEADER`; when the session's participant is another one, nothing is processed and the answer is
 * 409 `session_changed`. Every reply (this one included) names the session's participant in the same header.
 * A request without the header (an API token, QGIS) is not checked.
 */
export function sessionChanged(req: Request, sessionParticipant: string): Response | null {
  const claimed = req.headers.get(SESSION_PARTICIPANT_HEADER);
  if (claimed === null || claimed === sessionParticipant) return null;
  return withParticipant(
    new Response(
      JSON.stringify({
        v: SYNC_PROTOCOL_VERSION,
        code: SESSION_CHANGED_CODE,
        error: 'The session belongs to another participant.',
      }),
      { status: 409, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    ),
    sessionParticipant,
  );
}

/** Names the session's participant on a reply (the reply object is new, so its headers are writable). */
export function withParticipant(res: Response, sessionParticipant: string): Response {
  res.headers.set(SESSION_PARTICIPANT_HEADER, sessionParticipant);
  return res;
}
