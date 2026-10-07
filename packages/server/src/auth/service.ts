import { randomUUID } from 'node:crypto';
import type { Actor, Key } from '@ueberblick/core';
import type { Db } from '../db/driver';
import { isLivePreviewId } from '../preview/registry';
import type { Auth, AuthError, Authenticated, Principal, Session } from './contract';
import { createApiTokens } from './api-tokens';
import { API_REQUEST_PREFIX } from './cookie';
import { randomToken, safeEqual, sha256Hex, typeableToken } from './crypto';
import { checkPassword, hashPassword } from './password';
import {
  GENERATED_TOKEN,
  MIN_PASSWORD_LENGTH,
  RANDOM_BYTES,
  SESSION_RENEW_INTERVAL_MS,
  SESSION_TTL_MS,
  TOKEN_RULES,
  TOTP_PARAMS,
} from './params';
import { base32Decode, base32Encode, otpauthUri, totpAt, totpStep } from './totp';
import { hasLiveSession } from './live-session';
import { randomBytes } from 'node:crypto';

export interface AuthDeps {
  readonly control: Db;
  /** The only clock: injected so tests can move time. */
  readonly now: () => Date;
  /**
   * Roles of a participant in a project (`participants.roles` in the project database). Required: there is no
   * silent default. `null` means the participant is disabled (`disabled_at` set): no exchange, no session.
   * Called on every authenticate, so a role change applies on the next request.
   */
  readonly participantRoles: (projectId: string, participantId: string) => readonly Key[] | null;
  /**
   * Admin sign-in settings from the config (`ADMIN_TOTP`, `SESSION_DAYS_ADMIN_REMEMBER`): with `totp` off an admin
   * signs in with e-mail and password only; `rememberMs` is the session length of "30 Tage angemeldet bleiben".
   * Default: TOTP required, 30 days.
   */
  readonly admin?: { readonly totp: boolean; readonly rememberMs: number };
}

interface MfaState {
  secret: string;
  confirmed: boolean;
  lastStep: number;
}

const err = (code: AuthError['code']): AuthError => ({ code });
const subjectOf = (kind: Principal['kind'], id: string): string => `${kind}:${id}`;

const DEFAULT_ADMIN = { totp: true, rememberMs: 30 * 24 * 3600_000 } as const;

export function createAuth(deps: AuthDeps): Auth {
  const { control: db } = deps;
  const adminSettings = deps.admin ?? DEFAULT_ADMIN;
  const iso = (ms: number): string => new Date(ms).toISOString();
  const nowIso = (): string => deps.now().toISOString();
  let dummyHash: Promise<string> | undefined;

  const rolesFor = (accountId: string, projectId: string): readonly Key[] => {
    const row = db
      .prepare<{ role: string }>('SELECT role FROM memberships WHERE account_id = ? AND project_id = ?')
      .get(accountId, projectId);
    return row ? [row.role as Key] : [];
  };

  function openSession(principal: Principal, device: string | undefined, ttlMs?: number): Session {
    const id = randomToken(RANDOM_BYTES.sessionId);
    const expiresAt = iso(
      deps.now().getTime() + (ttlMs ?? SESSION_TTL_MS[principal.kind === 'admin' ? 'admin' : 'participant']),
    );
    db.prepare(
      'INSERT INTO sessions (id_hash, subject, project_id, device, expires_at) VALUES (?,?,?,?,?)',
    ).run(
      sha256Hex(id),
      subjectOf(principal.kind, principal.id),
      principal.projectId,
      device ?? null,
      expiresAt,
    );
    return { id, principal, expiresAt };
  }

  function readMfa(accountId: string): MfaState | null {
    const row = db.prepare<{ mfa: string | null }>('SELECT mfa FROM accounts WHERE id = ?').get(accountId);
    return row?.mfa ? (JSON.parse(row.mfa) as MfaState) : null;
  }

  function startTotp(accountId: string): { secret: string; otpauthUri: string } {
    const row = db
      .prepare<{ email: string | null }>('SELECT email FROM accounts WHERE id = ?')
      .get(accountId);
    if (!row) throw new Error('unknown account');
    const secret = base32Encode(randomBytes(TOTP_PARAMS.secretBytes));
    const state: MfaState = { secret, confirmed: false, lastStep: -1 };
    db.prepare('UPDATE accounts SET mfa = ? WHERE id = ?').run(JSON.stringify(state), accountId);
    return { secret, otpauthUri: otpauthUri(secret, row.email ?? accountId) };
  }

  const generateToken = (): string =>
    typeableToken(GENERATED_TOKEN.alphabet, GENERATED_TOKEN.chars, GENERATED_TOKEN.group);
  const tokenExists = (token: string): boolean =>
    db.prepare('SELECT 1 AS x FROM credentials WHERE token = ?').get(token) !== undefined;

  function checkIssue(projectId: string, expiresAt: string | undefined): string | null {
    // A live preview (A-031) is a project for credentials: its preview logins live under the preview's id.
    const real = db.prepare('SELECT 1 AS x FROM projects WHERE id = ?').get(projectId);
    if (!real && !isLivePreviewId(db, projectId)) throw new Error(`unknown project: ${projectId}`);
    if (expiresAt === undefined) return null;
    const ms = new Date(expiresAt).getTime();
    if (Number.isNaN(ms)) throw new Error(`invalid expiresAt: ${expiresAt}`);
    return iso(ms);
  }

  function insertCredential(
    token: string,
    projectId: string,
    participantId: string,
    expires: string | null,
  ): void {
    db.prepare(
      'INSERT INTO credentials (token, project_id, participant_id, expires_at) VALUES (?,?,?,?)',
    ).run(token, projectId, participantId, expires);
  }

  const apiTokens = createApiTokens({ control: db, now: deps.now, participantRoles: deps.participantRoles });

  const auth: Auth = {
    apiTokens,
    issueCredential(projectId, participantId, expiresAt) {
      const expires = checkIssue(projectId, expiresAt);
      let token = generateToken();
      while (tokenExists(token)) token = generateToken();
      insertCredential(token, projectId, participantId, expires);
      return { token };
    },

    issueChosenCredential(projectId, participantId, token, expiresAt) {
      const expires = checkIssue(projectId, expiresAt);
      if (token.length < TOKEN_RULES.minLength) return err('token_too_short');
      if (token.length > TOKEN_RULES.maxLength || !TOKEN_RULES.pattern.test(token))
        return err('token_invalid');
      if (tokenExists(token)) return err('token_duplicate');
      insertCredential(token, projectId, participantId, expires);
      return { token };
    },

    listCredentials(projectId, participantId) {
      return db
        .prepare<{
          participant_id: string;
          expires_at: string | null;
          last_used_at: string | null;
          revoked_at: string | null;
        }>(
          `SELECT participant_id, expires_at, last_used_at, revoked_at FROM credentials
           WHERE project_id = ? AND (? IS NULL OR participant_id = ?)
           ORDER BY participant_id, expires_at`,
        )
        .all(projectId, participantId ?? null, participantId ?? null)
        .map((r) => ({
          participantId: r.participant_id,
          expiresAt: r.expires_at,
          lastUsedAt: r.last_used_at,
          revokedAt: r.revoked_at,
        }));
    },

    countActiveCredentials(projectId, at) {
      const rows = db
        .prepare<{ participant_id: string; n: number }>(
          `SELECT participant_id, COUNT(*) AS n FROM credentials
           WHERE project_id = ? AND revoked_at IS NULL
             AND (expires_at IS NULL OR expires_at > ?)
           GROUP BY participant_id`,
        )
        .all(projectId, at);
      return new Map(rows.map((r) => [r.participant_id, r.n]));
    },

    sessionExpiry(sessionId) {
      if (!sessionId) return null;
      const row = db
        .prepare<{ expires_at: string }>('SELECT expires_at FROM sessions WHERE id_hash = ?')
        .get(sha256Hex(sessionId));
      return row && row.expires_at > nowIso() ? row.expires_at : null;
    },

    currentCredential(projectId, participantId) {
      const row = db
        .prepare<{ token: string; expires_at: string | null; last_used_at: string | null }>(
          `SELECT token, expires_at, last_used_at FROM credentials
           WHERE project_id = ? AND participant_id = ? AND revoked_at IS NULL
           ORDER BY rowid DESC LIMIT 1`,
        )
        .get(projectId, participantId);
      if (!row) return null;
      return { token: row.token, expiresAt: row.expires_at, lastUsedAt: row.last_used_at };
    },

    replaceCredential(projectId, participantId, chosen, expiresAt) {
      const expires = checkIssue(projectId, expiresAt);
      if (chosen !== undefined) {
        if (chosen.length < TOKEN_RULES.minLength) return err('token_too_short');
        if (chosen.length > TOKEN_RULES.maxLength || !TOKEN_RULES.pattern.test(chosen))
          return err('token_invalid');
      }
      const current = auth.currentCredential(projectId, participantId);
      if (chosen !== undefined && current !== null && safeEqual(current.token, chosen)) {
        // The token that is already current: only its expiry moves (one write, no new row).
        db.prepare('UPDATE credentials SET expires_at = ? WHERE token = ?').run(expires, chosen);
        return { ...current, expiresAt: expires };
      }
      let issued: string;
      if (chosen === undefined) {
        issued = generateToken();
        while (tokenExists(issued)) issued = generateToken();
      } else if (tokenExists(chosen)) {
        return err('token_duplicate');
      } else {
        issued = chosen;
      }
      db.transaction(() => {
        insertCredential(issued, projectId, participantId, expires);
        db.prepare(
          'UPDATE credentials SET revoked_at = ? WHERE project_id = ? AND participant_id = ? AND token <> ? AND revoked_at IS NULL',
        ).run(nowIso(), projectId, participantId, issued);
      });
      return { token: issued, expiresAt: expires, lastUsedAt: null };
    },

    tokensInUse: (tokens) => new Set(tokens.filter(tokenExists)),
    exchange(token, device) {
      const row = db
        .prepare<{
          project_id: string;
          participant_id: string;
          expires_at: string | null;
          revoked_at: string | null;
        }>('SELECT project_id, participant_id, expires_at, revoked_at FROM credentials WHERE token = ?')
        .get(token);
      if (!row) return err('credential_unknown');
      if (row.revoked_at) return err('credential_revoked');
      if (row.expires_at && row.expires_at <= nowIso()) return err('credential_expired');
      const roles = deps.participantRoles(row.project_id, row.participant_id);
      if (roles === null) return err('participant_disabled');
      db.prepare('UPDATE credentials SET last_used_at = ? WHERE token = ?').run(nowIso(), token);
      return openSession(
        { kind: 'participant', id: row.participant_id, projectId: row.project_id, roles },
        device,
      );
    },

    authenticate(sessionId) {
      if (!sessionId) return null;
      if (sessionId.startsWith(API_REQUEST_PREFIX))
        return apiTokens.authenticate(sessionId.slice(API_REQUEST_PREFIX.length));
      const idHash = sha256Hex(sessionId);
      const row = db
        .prepare<{ subject: string; project_id: string | null; expires_at: string }>(
          'SELECT subject, project_id, expires_at FROM sessions WHERE id_hash = ?',
        )
        .get(idHash);
      const now = deps.now().getTime();
      if (!row || row.expires_at <= iso(now)) return null;
      const cut = row.subject.indexOf(':');
      const kind = row.subject.slice(0, cut) as Principal['kind'];
      const id = row.subject.slice(cut + 1);
      let roles: readonly Key[] = [];
      if (kind === 'participant' && row.project_id) {
        const live = deps.participantRoles(row.project_id, id);
        if (live === null) return null; // disabled since the session was opened
        roles = live;
      }
      const principal: Authenticated = { kind, id, projectId: row.project_id, roles };
      if (kind !== 'participant') return principal;
      // The last renewal is implied by the expiry (expires_at = renewal + TTL): no extra column, no extra query.
      if (now - (Date.parse(row.expires_at) - SESSION_TTL_MS.participant) < SESSION_RENEW_INTERVAL_MS)
        return principal;
      const renewedExpiresAt = now + SESSION_TTL_MS.participant;
      db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').run(iso(renewedExpiresAt), idHash);
      return { ...principal, renewedExpiresAt };
    },

    toActor: (p): Actor => ({ id: p.id, kind: p.kind, roles: p.roles }),

    rolesFor,

    hasLiveSession: (projectId, participantId) => hasLiveSession(db, projectId, participantId, nowIso()),
    revokeParticipant(projectId, participantId) {
      db.transaction(() => {
        apiTokens.revokeParticipant(projectId, participantId);
        db.prepare(
          'UPDATE credentials SET revoked_at = ? WHERE project_id = ? AND participant_id = ? AND revoked_at IS NULL',
        ).run(nowIso(), projectId, participantId);
        db.prepare('DELETE FROM sessions WHERE subject = ? AND project_id = ?').run(
          subjectOf('participant', participantId),
          projectId,
        );
      });
    },

    reassignCredentials(projectId, from, to) {
      db.transaction(() => {
        db.prepare(
          'UPDATE credentials SET participant_id = ? WHERE project_id = ? AND participant_id = ? AND revoked_at IS NULL',
        ).run(to, projectId, from);
        const gone = subjectOf('participant', from);
        db.prepare('DELETE FROM sessions WHERE subject = ? AND project_id = ?').run(gone, projectId);
      });
    },

    revokeSession(sessionId) {
      db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256Hex(sessionId));
    },
    revokeAccountSessions(accountId) {
      apiTokens.revokeAdmin(accountId);
      db.prepare('DELETE FROM sessions WHERE subject = ?').run(subjectOf('admin', accountId));
    },

    async createAdmin(email, password) {
      if (password.length < MIN_PASSWORD_LENGTH)
        throw new Error(`password shorter than ${MIN_PASSWORD_LENGTH}`);
      const id = randomUUID();
      const hash = await hashPassword(password);
      db.prepare('INSERT INTO accounts (id, email, password_hash) VALUES (?,?,?)').run(
        id,
        email.trim().toLowerCase(),
        hash,
      );
      return id;
    },

    async verifyPassword(accountId, password) {
      const row = db
        .prepare<{ password_hash: string | null }>('SELECT password_hash FROM accounts WHERE id = ?')
        .get(accountId);
      dummyHash ??= hashPassword('dummy');
      // Unknown accounts cost the same time as wrong passwords.
      const ok = await checkPassword(password, row?.password_hash ?? (await dummyHash));
      return ok && !!row?.password_hash;
    },

    enrolTotp(accountId) {
      if (readMfa(accountId)?.confirmed) throw new Error('TOTP already enrolled; use resetTotp');
      return startTotp(accountId);
    },

    resetTotp(accountId) {
      const started = startTotp(accountId); // fresh state: lastStep cleared, unconfirmed
      auth.revokeAccountSessions(accountId);
      return started;
    },

    verifyTotp(accountId, code) {
      const state = readMfa(accountId);
      if (!state || !/^\d+$/.test(code) || code.length !== TOTP_PARAMS.digits) return false;
      const key = base32Decode(state.secret);
      const now = deps.now().getTime();
      const current = totpStep(now);
      let matched = -1;
      for (let d = -TOTP_PARAMS.windowSteps; d <= TOTP_PARAMS.windowSteps; d++) {
        // No early exit: every step is compared, so timing does not reveal which one matched.
        if (safeEqual(totpAt(key, now + d * TOTP_PARAMS.periodSeconds * 1000), code)) matched = current + d;
      }
      if (matched <= state.lastStep) return false;
      const next: MfaState = { ...state, confirmed: true, lastStep: matched };
      const res = db
        .prepare('UPDATE accounts SET mfa = ? WHERE id = ? AND mfa = ?')
        .run(JSON.stringify(next), accountId, JSON.stringify(state));
      return res.changes === 1;
    },

    openAdminSession(accountId, device) {
      if (!db.prepare('SELECT 1 AS x FROM accounts WHERE id = ?').get(accountId))
        throw new Error('unknown account');
      return openSession({ kind: 'admin', id: accountId, projectId: null, roles: [] }, device);
    },

    async loginAdmin(email, password, totpCode, device, options) {
      const row = db
        .prepare<{ id: string }>('SELECT id FROM accounts WHERE email = ?')
        .get(email.trim().toLowerCase());
      const id = row?.id ?? '';
      const passwordOk = await auth.verifyPassword(id, password);
      if (!row || !passwordOk) return err('invalid_login');
      const ttl = options?.remember === true ? adminSettings.rememberMs : undefined;
      const principal: Principal = { kind: 'admin', id: row.id, projectId: null, roles: [] };
      if (!adminSettings.totp) return openSession(principal, device, ttl);
      const mfa = readMfa(row.id);
      // The password was right but no TOTP is confirmed yet: a blank code asks for enrolment (a fresh secret, shown
      // now); a code confirms a pending enrolment (the first valid code) and signs in.
      if (!mfa?.confirmed && totpCode.length === 0)
        return { code: 'mfa_not_enrolled', otpauthUri: startTotp(row.id).otpauthUri };
      if (!mfa) return err('mfa_not_enrolled');
      if (!auth.verifyTotp(row.id, totpCode)) return err('invalid_login');
      return openSession(principal, device, ttl);
    },
  };
  return auth;
}
