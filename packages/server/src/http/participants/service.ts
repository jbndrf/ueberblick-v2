/**
 * The QR logins of the roster's participants (WP-168) and the admin list: plain functions over the project database
 * and the `Auth` module (credentials and sessions live there). The roster itself is `roster.ts`.
 */
import { isAuthError } from '../../auth/contract';
import {
  fail,
  listParticipants,
  row,
  type Done,
  type Failure,
  type ParticipantsCtx,
  type RosterEntry,
} from './roster';

/** One active QR login. The token is shown once at issue and is not stored, so it cannot appear here. */
export interface ActiveQr {
  readonly participantId: string;
  readonly expiresAt: string | null;
}

/** The roster for the admin list: each entry with its count of active QR logins, from one grouped query. */
export function listRoster(
  ctx: ParticipantsCtx,
  opts: { readonly guests: boolean },
): readonly (RosterEntry & { readonly activeQrs: number })[] {
  const counts = ctx.auth.countActiveCredentials(ctx.projectId, ctx.now().toISOString());
  return listParticipants(ctx, opts).map((p) => ({ ...p, activeQrs: counts.get(p.id) ?? 0 }));
}

/** Validates an optional expiry: a date in the future. */
function expiryOf(ctx: ParticipantsCtx, expiresAt: string | null | undefined): string | null | Failure {
  if (expiresAt === undefined || expiresAt === null) return null;
  const ms = new Date(expiresAt).getTime();
  if (Number.isNaN(ms) || ms <= ctx.now().getTime()) return fail('invalid_expiry');
  return new Date(ms).toISOString();
}

/** Issues a generated login token. v3 tokens did not expire unless the admin set a date, so there is no default expiry. */
export function issueQr(
  ctx: ParticipantsCtx,
  participantId: string,
  expiresAt?: string,
): { readonly ok: true; readonly token: string; readonly expiresAt: string | null } | Failure {
  const current = row(ctx.db, participantId);
  if (!current) return fail('participant_unknown');
  if (current.disabled_at) return fail('participant_disabled');
  const expires = expiryOf(ctx, expiresAt);
  if (typeof expires === 'object' && expires !== null) return expires;
  const { token } = ctx.auth.issueCredential(ctx.projectId, participantId, expires ?? undefined);
  return { ok: true, token, expiresAt: expires };
}

/** The participant's current login token as the admin sees it. The link is relative to the app origin. */
export interface CredentialView {
  readonly token: string;
  readonly link: string;
  readonly expiresAt: string | null;
  readonly lastUsedAt: string | null;
}

const loginLink = (token: string): string => `/login?token=${encodeURIComponent(token)}`;

/** The newest token of the participant that is not revoked (an expired one is still shown, with its date). */
export function currentCredential(
  ctx: ParticipantsCtx,
  participantId: string,
): { readonly ok: true; readonly credential: CredentialView } | Failure {
  if (!row(ctx.db, participantId)) return fail('participant_unknown');
  const c = ctx.auth.currentCredential(ctx.projectId, participantId);
  if (!c) return fail('credential_none');
  return { ok: true, credential: { ...c, link: loginLink(c.token) } };
}

/**
 * Sets the chosen token, or generates one, and revokes the participant's earlier tokens (sessions stay).
 * A refused token changes nothing. Setting the token that is already current only updates its expiry.
 */
export function setCredential(
  ctx: ParticipantsCtx,
  participantId: string,
  input: { readonly token?: string; readonly expiresAt?: string | null },
): { readonly ok: true; readonly credential: CredentialView } | Failure {
  const person = row(ctx.db, participantId);
  if (!person) return fail('participant_unknown');
  if (person.disabled_at) return fail('participant_disabled');
  const expires = expiryOf(ctx, input.expiresAt);
  if (typeof expires === 'object' && expires !== null) return expires;
  const r = ctx.auth.replaceCredential(ctx.projectId, participantId, input.token, expires ?? undefined);
  if (isAuthError(r)) {
    return fail(r.code === 'token_duplicate' || r.code === 'token_too_short' ? r.code : 'token_invalid');
  }
  return { ok: true, credential: { ...r, link: loginLink(r.token) } };
}

/** The QR logins that can still be exchanged: not revoked, not expired. */
export function listQrs(ctx: ParticipantsCtx, participantId?: string): readonly ActiveQr[] {
  const now = ctx.now().toISOString();
  return ctx.auth
    .listCredentials(ctx.projectId, participantId)
    .filter((c) => c.revokedAt === null && (c.expiresAt === null || c.expiresAt > now))
    .map((c) => ({ participantId: c.participantId, expiresAt: c.expiresAt }));
}

/** Revokes every QR login of the participant and ends their sessions. */
export function revokeQrs(ctx: ParticipantsCtx, participantId: string): Done {
  if (!row(ctx.db, participantId)) return fail('participant_unknown');
  ctx.auth.revokeParticipant(ctx.projectId, participantId);
  return { ok: true };
}
