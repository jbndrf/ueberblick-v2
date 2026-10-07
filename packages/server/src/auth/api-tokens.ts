/**
 * API tokens (WP-388, A-037; admin tokens WP-1070): the admin-created tokens that let QGIS and other GIS clients act
 * as a participant (Q18) or as the issuing admin. Not a login token: many per owner, hashed at rest, shown once, never exchangeable for
 * a session. `authenticate` returns the same principal a session would, so every project endpoint accepts it.
 */
import { randomUUID } from 'node:crypto';
import type { Key } from '@ueberblick/core';
import type { Db } from '../db/driver';
import type { ApiToken, ApiTokenInfo, ApiTokens, AuthError, Authenticated } from './contract';
import { randomToken, sha256Hex } from './crypto';
import { RANDOM_BYTES } from './params';

/** The prefix every API token has (v3's `ubk_`); it tells a token from a session id before any lookup. */
export const API_TOKEN_PREFIX = 'ubk_';
/** `last_used_at` is written at most this often per token: a QGIS map pan is dozens of requests. */
const LAST_USED_GRANULARITY_MS = 60_000;
const MAX_LABEL = 100;

interface Row {
  id: string;
  project_id: string;
  participant_id: string | null;
  account_id: string | null;
  email: string | null;
  label: string;
  last_four: string;
  scope: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

const SELECT = `SELECT t.id, t.project_id, t.participant_id, t.account_id, a.email, t.label, t.last_four, t.scope,
  t.created_at, t.expires_at, t.last_used_at, t.revoked_at FROM api_tokens t LEFT JOIN accounts a ON a.id = t.account_id`;

const infoOf = (r: Row): ApiTokenInfo => ({
  id: r.id,
  participantId: r.participant_id,
  adminId: r.account_id,
  adminEmail: r.email,
  label: r.label,
  lastFour: r.last_four,
  scope: r.scope as ApiTokenInfo['scope'],
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  lastUsedAt: r.last_used_at,
});

export function createApiTokens(deps: {
  readonly control: Db;
  readonly now: () => Date;
  /** `null`: no such participant or disabled (the same function `authenticate` asks). */
  readonly participantRoles: (projectId: string, participantId: string) => readonly Key[] | null;
}): ApiTokens {
  const db = deps.control;
  const nowIso = (): string => deps.now().toISOString();

  /** Both owners share everything but who the token acts as (WP-1070: a participant, or an admin account). */
  function issueFor(
    projectId: string,
    owner: { readonly participantId: string } | { readonly accountId: string },
    opts: { readonly label: string; readonly expiresAt?: string },
  ): ApiToken | AuthError {
    const label = opts.label.trim();
    if (label === '' || label.length > MAX_LABEL) return { code: 'token_invalid' };
    if (!db.prepare('SELECT 1 AS x FROM projects WHERE id = ?').get(projectId))
      throw new Error(`unknown project: ${projectId}`);
    let expires: string | null = null;
    if (opts.expiresAt !== undefined) {
      const ms = new Date(opts.expiresAt).getTime();
      if (Number.isNaN(ms)) throw new Error(`invalid expiresAt: ${opts.expiresAt}`);
      expires = new Date(ms).toISOString();
    }
    const participantId = 'participantId' in owner ? owner.participantId : null;
    const accountId = 'accountId' in owner ? owner.accountId : null;
    const known =
      participantId === null
        ? db.prepare('SELECT 1 AS x FROM accounts WHERE id = ?').get(accountId)
        : deps.participantRoles(projectId, participantId) !== null;
    if (!known) return { code: 'participant_disabled' };
    const token = `${API_TOKEN_PREFIX}${randomToken(RANDOM_BYTES.token)}`;
    const id = randomUUID();
    db.prepare(
      `INSERT INTO api_tokens (id, token_hash, project_id, participant_id, account_id, label, last_four, created_at, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      sha256Hex(token),
      projectId,
      participantId,
      accountId,
      label,
      token.slice(-4),
      nowIso(),
      expires,
    );
    const row = db.prepare<Row>(`${SELECT} WHERE t.id = ?`).get(id) as Row;
    return { token, info: infoOf(row) };
  }

  return {
    issue: (projectId, participantId, opts) => issueFor(projectId, { participantId }, opts),
    issueAdmin: (projectId, accountId, opts) => issueFor(projectId, { accountId }, opts),

    list(projectId) {
      return db
        .prepare<Row>(
          `${SELECT} WHERE t.project_id = ? AND t.revoked_at IS NULL ORDER BY t.created_at, t.rowid`,
        )
        .all(projectId)
        .map(infoOf);
    },

    revoke(projectId, id) {
      const r = db
        .prepare(
          'UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND project_id = ? AND revoked_at IS NULL',
        )
        .run(nowIso(), id, projectId);
      return r.changes > 0;
    },

    authenticate(token): Authenticated | null {
      if (!token.startsWith(API_TOKEN_PREFIX)) return null;
      const row = db.prepare<Row>(`${SELECT} WHERE t.token_hash = ?`).get(sha256Hex(token));
      if (!row || row.revoked_at) return null;
      const now = nowIso();
      if (row.expires_at && row.expires_at <= now) return null;
      let principal: Authenticated;
      if (row.participant_id === null) {
        if (row.account_id === null || row.email === null) return null; // the admin account is gone
        principal = { kind: 'admin', id: row.account_id, projectId: row.project_id, roles: [] };
      } else {
        const roles = deps.participantRoles(row.project_id, row.participant_id);
        if (roles === null) return null;
        principal = { kind: 'participant', id: row.participant_id, projectId: row.project_id, roles };
      }
      if (
        !row.last_used_at ||
        deps.now().getTime() - Date.parse(row.last_used_at) >= LAST_USED_GRANULARITY_MS
      )
        db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now, row.id);
      return principal;
    },

    revokeParticipant(projectId, participantId) {
      db.prepare(
        'UPDATE api_tokens SET revoked_at = ? WHERE project_id = ? AND participant_id = ? AND revoked_at IS NULL',
      ).run(nowIso(), projectId, participantId);
    },

    revokeAdmin(accountId) {
      db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL').run(
        nowIso(),
        accountId,
      );
    },
  };
}
