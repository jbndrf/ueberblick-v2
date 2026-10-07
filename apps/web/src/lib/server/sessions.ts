import { readSessionCookie, type Auth, type Authenticated, type SessionKind } from '@ueberblick/server';

/** What the browser's cookies resolve to (WP-705; v3 `hooks.server.ts:84-97`): each session on its own. */
export interface Sessions {
  readonly admin: Authenticated | null;
  readonly participant: Authenticated | null;
  /** The participant cookie's session id, for the sliding renewal. */
  readonly participantId: string | null;
}

const ofKind = (who: Authenticated | null, kind: SessionKind): Authenticated | null =>
  who?.kind === kind ? who : null;

/**
 * Resolves the admin and the participant cookie independently. A cookie that is unknown, expired or holds a session of
 * the other kind counts as absent, so a participant session never opens the admin area (and the other way round).
 */
export function sessionsOf(request: Request, auth: Pick<Auth, 'authenticate'>): Sessions {
  const participantId = readSessionCookie(request, 'participant');
  return {
    participantId,
    participant: ofKind(auth.authenticate(participantId), 'participant'),
    admin: ofKind(auth.authenticate(readSessionCookie(request, 'admin')), 'admin'),
  };
}
