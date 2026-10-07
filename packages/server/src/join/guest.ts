/**
 * Guest self-join (WP-639, B-016): the system adds a participant to the roster, exactly like an admin roster write
 * (`http/participants/service.ts`), and signs them in. It is not a run: the roster is not feature data (R3 covers
 * features). The guest is named what they typed (WP-1074, `cleanGuestName`; empty gives "Gast"), gets a generated token (no placeholder e-mail, v3 bug B7) and is marked with
 * `self_joined` and `created_at`, which the expiry timer reads (`timers/guest-expiry.ts`).
 *
 * Opening the link never creates anything (v3 bug B12, link previews): the caller creates a guest only for a POST.
 * A device that already holds a session of a participant of the same project is not given a second guest (v3).
 */
import { randomBytes } from 'node:crypto';
import type { Auth, Principal, Session } from '../auth/contract';
import { isAuthError } from '../auth/contract';
import type { Db } from '../db/driver';
import { resolveSlug } from './links';
import type { JoinErrorCode } from './registry';

export interface JoinDeps {
  readonly control: Db;
  /** The project database for a project key. */
  projectDb(projectKey: string): Db;
  readonly auth: Auth;
  readonly now: () => Date;
}

export type JoinResult =
  | { readonly ok: true; readonly kind: 'existing' }
  | { readonly ok: true; readonly kind: 'created'; readonly participantId: string; readonly session: Session }
  | { readonly ok: false; readonly code: JoinErrorCode };

/** The name every guest gets. */
export const GUEST_NAME = 'Gast';

/** The longest guest name kept. */
export const GUEST_NAME_MAX = 40;

/** What a guest typed as a name (WP-1074): no markup or control characters, single spaces, capped; empty gives "Gast". */
export function cleanGuestName(raw: unknown): string {
  if (typeof raw !== 'string') return GUEST_NAME;
  const text = raw
    .replace(/<[^>]*>?/g, ' ')
    .replace(/[<>&"`\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const capped = Array.from(text).slice(0, GUEST_NAME_MAX).join('').trim();
  return capped === '' ? GUEST_NAME : capped;
}

/** Whether a link with this slug is switched on (the GET of `/join/<slug>`: nothing is created). */
export const isJoinable = (control: Db, slug: string): boolean => resolveSlug(control, slug) !== undefined;

/** POST of `/join/<slug>`: signs the caller's own guest in again, or creates one and signs them in. */
export function joinAsGuest(
  deps: JoinDeps,
  slug: string,
  current: Principal | null,
  name?: unknown,
): JoinResult {
  const target = resolveSlug(deps.control, slug);
  if (!target) return { ok: false, code: 'link_unknown' };
  if (current?.kind === 'participant' && current.projectId === target.projectId)
    return { ok: true, kind: 'existing' };

  const db = deps.projectDb(target.projectKey);
  const id = `gast-${randomBytes(4).toString('hex')}`;
  const attrs = JSON.stringify({ created_by: 'system', join_slug: slug });
  db.prepare(
    'INSERT INTO participants (id, name, roles, attrs, self_joined, created_at) VALUES (?,?,?,?,1,?)',
  ).run(id, cleanGuestName(name), JSON.stringify([target.role]), attrs, deps.now().toISOString());
  const { token } = deps.auth.issueCredential(target.projectId, id);
  const session = deps.auth.exchange(token, 'join');
  if (isAuthError(session)) return { ok: false, code: 'join_failed' };
  return { ok: true, kind: 'created', participantId: id, session };
}
