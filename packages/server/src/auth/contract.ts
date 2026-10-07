/**
 * CONTRACT of the auth module (WP-103). A `Principal` is provider-agnostic: QR login, password + TOTP
 * and (Phase 7) OIDC all end in a `Session` whose principal maps onto a core `Actor`.
 */
import type { Actor, ActorKind, Instant, Key } from '@ueberblick/core';
import type { ApiTokenScope, AuthErrorCode } from './registry';

export interface AuthError {
  readonly code: AuthErrorCode;
  /** Only with `mfa_not_enrolled` from `loginAdmin` when TOTP is on: the secret to enrol, shown once to the admin who proved the password. */
  readonly otpauthUri?: string;
}

export function isAuthError(x: object): x is AuthError {
  return 'code' in x && !('id' in x);
}

/** Who is calling. `kind` is a core actor kind (`participant` or `admin`). */
export interface Principal {
  readonly kind: ActorKind; // 'participant' or 'admin' here
  /** participants.id for a participant, accounts.id for an admin. */
  readonly id: string;
  /** Project the session is bound to; null for an admin session (roles are per project via `rolesFor`). */
  readonly projectId: string | null;
  /** Roles in `projectId`. Empty for an admin session; ask `rolesFor(id, project)`. */
  readonly roles: readonly Key[];
}

/** What `authenticate` returns: the principal, plus the new expiry when this call slid the session forward. */
export interface Authenticated extends Principal {
  /** Epoch ms of the new expiry, set only when `expires_at` moved (at most once per 24 h per session). The HTTP layer re-sets the cookie (WP-608). */
  readonly renewedExpiresAt?: number;
}

export interface Session {
  /** The cookie value. Shown once; only its hash is stored. */
  readonly id: string;
  readonly principal: Principal;
  readonly expiresAt: Instant;
}

/** One issued participant token as an admin sees it, without the token itself (read it via `currentCredential`, WP-607). */
export interface CredentialInfo {
  readonly participantId: string;
  readonly expiresAt: Instant | null;
  readonly lastUsedAt: Instant | null;
  readonly revokedAt: Instant | null;
}

/** The current login token of a participant as an admin sees it (WP-607): readable, with its expiry and last use. */
export interface Credential {
  readonly token: string;
  readonly expiresAt: Instant | null;
  readonly lastUsedAt: Instant | null;
}

/** One API token as an admin sees it (WP-388): never the token itself, only its last four characters. */
export interface ApiTokenInfo {
  readonly id: string;
  /** The owner: a participant, or (null) an admin account. */
  readonly participantId: string | null;
  /** accounts.id of the issuing admin for an admin token (WP-1070), else null. */
  readonly adminId: string | null;
  /** The admin's email for an admin token, else null. */
  readonly adminEmail: string | null;
  readonly label: string;
  readonly lastFour: string;
  readonly scope: ApiTokenScope;
  readonly createdAt: Instant;
  readonly expiresAt: Instant | null;
  readonly lastUsedAt: Instant | null;
}

/** A freshly issued API token: the secret is returned here once and cannot be read again. */
export interface ApiToken {
  readonly token: string;
  readonly info: ApiTokenInfo;
}

/** The QGIS / GIS tokens of a project (WP-388, A-037). */
export interface ApiTokens {
  /**
   * Issues a token for a participant. Refused with `token_invalid` for an empty or over-long label and with
   * `participant_disabled` for an unknown or disabled participant. Throws for an unknown project or a malformed `expiresAt`.
   */
  issue(
    projectId: string,
    participantId: string,
    opts: { readonly label: string; readonly expiresAt?: Instant },
  ): ApiToken | AuthError;
  /**
   * Issues a token that authenticates as the admin account (WP-1070), valid only for `projectId`. `token_invalid` for a
   * bad label, `participant_disabled` for an unknown account.
   */
  issueAdmin(
    projectId: string,
    accountId: string,
    opts: { readonly label: string; readonly expiresAt?: Instant },
  ): ApiToken | AuthError;
  /** The tokens that are not revoked, oldest first. */
  list(projectId: string): readonly ApiTokenInfo[];
  /** False when there is no such live token in the project. */
  revoke(projectId: string, id: string): boolean;
  /** The participant principal of a live token, or null (unknown, revoked, expired, participant disabled). */
  authenticate(token: string): Authenticated | null;
  /** Revokes every token of a participant (`Auth.revokeParticipant` calls it). */
  revokeParticipant(projectId: string, participantId: string): void;
  /** Revokes every token of an admin account in every project (`Auth.revokeAccountSessions` calls it). */
  revokeAdmin(accountId: string): void;
}

export interface Auth {
  /** The QGIS / GIS tokens. `authenticate('api:<token>')` accepts one, the form `readSessionCookie` returns for a request. */
  readonly apiTokens: ApiTokens;
  /** Generates a typeable token (`XXXX-XXXX-XXXX-XXXX-XXXX`, 100 bits), stored readable. Throws for an unknown project. */
  issueCredential(projectId: string, participantId: string, expiresAt?: Instant): { readonly token: string };
  /**
   * Like `issueCredential` with an admin-chosen token (`TOKEN_RULES`). Refused with `token_duplicate` (unique in the
   * whole instance), `token_too_short` or `token_invalid`. Throws for an unknown project.
   */
  issueChosenCredential(
    projectId: string,
    participantId: string,
    token: string,
    expiresAt?: Instant,
  ): { readonly token: string } | AuthError;
  /**
   * The credentials of a project (optionally of one participant), newest expiry last.
   * The caller filters (for example active = not revoked, not expired).
   */
  listCredentials(projectId: string, participantId?: string): readonly CredentialInfo[];
  /**
   * How many credentials of each participant can still be exchanged at `at` (not revoked, not expired),
   * from one grouped query. Participants with none are absent. O(credentials of the project), once, not per participant.
   */
  countActiveCredentials(projectId: string, at: Instant): ReadonlyMap<string, number>;
  /** When the session ends (the live value after a slide), or `null` for an unknown or expired session. One indexed lookup. */
  sessionExpiry(sessionId: string | null | undefined): Instant | null;
  /**
   * The current login token of a participant (WP-607): the newest that is not revoked. An expired token is
   * still returned, with its date. `null` when the participant has none.
   */
  currentCredential(projectId: string, participantId: string): Credential | null;
  /**
   * Replaces the participant's login tokens (WP-607): issues the chosen (`TOKEN_RULES`) or a generated token and
   * revokes the participant's other tokens in one transaction (sessions stay). Setting the token that is already
   * current only updates its expiry. Returns the new current token. Refused with `token_duplicate`, `token_too_short`
   * or `token_invalid`, and a refusal changes nothing. Throws for an unknown project or a malformed `expiresAt`.
   */
  replaceCredential(
    projectId: string,
    participantId: string,
    token?: string,
    expiresAt?: Instant,
  ): Credential | AuthError;
  /**
   * Which of the given login tokens exist in the instance (any project, revoked or not: a token stays unique, WP-607).
   * One primary-key lookup per token. Used by the project ZIP import to refuse a colliding roster before it creates
   * anything (A-046).
   */
  tokensInUse(tokens: readonly string[]): ReadonlySet<string>;
  /** Reusable: any number of times, on any device, until revoked or expired. Sets `last_used_at` and opens a session. */
  exchange(token: string, device?: string): Session | AuthError;
  /**
   * `null` for unknown, expired or revoked sessions and for a disabled participant. One indexed lookup; a participant
   * session also slides: when its last renewal is 24 h or more ago, `expires_at` moves to now + 90 days (one write, and
   * `renewedExpiresAt` is set). Admin sessions never slide.
   */
  authenticate(sessionId: string | null | undefined): Authenticated | null;
  toActor(principal: Principal): Actor;
  /** Roles of an admin account in a project (memberships). */
  rolesFor(accountId: string, projectId: string): readonly Key[];

  /** Revokes all credentials of a participant and ends their sessions. */
  revokeParticipant(projectId: string, participantId: string): void;
  /**
   * Moves the live (not revoked) tokens of participant `from` to participant `to` of the same project and ends `from`'s
   * sessions (WP-373: a preview reset gives its logins new participant ids and keeps the tokens, A-034).
   */
  reassignCredentials(projectId: string, from: string, to: string): void;
  /**
   * Whether the participant has a session that has not expired. A participant session lasts 90 days from its last
   * renewal and every authenticated use renews it (at most daily), so "has a live session" is "used within 90 days"
   * (WP-1073: the guest inactivity rule). One indexed lookup (`sessions_by_subject`).
   */
  hasLiveSession(projectId: string, participantId: string): boolean;
  revokeSession(sessionId: string): void;
  revokeAccountSessions(accountId: string): void;

  createAdmin(email: string, password: string): Promise<string>;
  verifyPassword(accountId: string, password: string): Promise<boolean>;
  /** Starts enrolment; throws when TOTP is already confirmed (see `resetTotp`). TOTP counts as enrolled after the first successful `verifyTotp`. */
  enrolTotp(accountId: string): { readonly secret: string; readonly otpauthUri: string };
  /** Admin path: replaces a confirmed TOTP with a fresh unconfirmed one (clears the used-step marker) and ends the account's sessions. */
  resetTotp(accountId: string): { readonly secret: string; readonly otpauthUri: string };
  /** RFC 6238, +-1 step. A step can be used once (replay protection). */
  verifyTotp(accountId: string, code: string): boolean;
  /** Opens the same kind of session as `loginAdmin`, for a login proven elsewhere (OIDC). Throws for an unknown account. */
  openAdminSession(accountId: string, device?: string): Session;
  /**
   * Admin sign-in. With TOTP off (`ADMIN_TOTP=off`) the code is ignored. With it on: a confirmed TOTP needs a valid code;
   * with none confirmed, a blank code returns `mfa_not_enrolled` plus the `otpauthUri`, and the first valid code
   * confirms the enrolment and signs in. `remember` gives the long session (`SESSION_DAYS_ADMIN_REMEMBER`), else 12 h.
   */
  loginAdmin(
    email: string,
    password: string,
    totpCode: string,
    device?: string,
    options?: { readonly remember?: boolean },
  ): Promise<Session | AuthError>;
}
