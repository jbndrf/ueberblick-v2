// WP-373: a preview (A-031) is a project of its own for credentials: tokens can be issued for its id, and moved to
// another participant of it without changing the token (a reset keeps the logins, A-034).
import { describe, expect, it } from 'vitest';
import type { Key } from '@ueberblick/core';
import { openControlDb } from '../db/open';
import { isAuthError } from './contract';
import { createAuth } from './service';

function setup() {
  const db = openControlDb(':memory:');
  db.prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)').run('p1', 'p1', 'p1', 'x');
  db.prepare(
    "INSERT INTO previews (project_id, id, key, generation, status, created_at) VALUES ('p1','pv1','p1__vorschau',1,'ready','x')",
  ).run();
  const auth = createAuth({
    control: db,
    now: () => new Date('2026-10-01T00:00:00.000Z'),
    participantRoles: () => ['a' as Key],
  });
  return { db, auth };
}

describe('credentials of a preview', () => {
  it('issues a token for a live preview id and signs in with it', () => {
    const { auth } = setup();
    const { token } = auth.issueCredential('pv1', 'preview-g1-none');
    const s = auth.exchange(token);
    expect(isAuthError(s)).toBe(false);
    if (!isAuthError(s)) expect(s.principal.projectId).toBe('pv1');
  });

  it('refuses a dropped preview like an unknown project', () => {
    const { auth, db } = setup();
    db.prepare("UPDATE previews SET status = 'dropped'").run();
    expect(() => auth.issueCredential('pv1', 'x')).toThrow(/unknown project/);
  });

  it('reassignCredentials moves the live tokens to another participant and ends the old sessions', () => {
    const { auth } = setup();
    const { token } = auth.issueCredential('pv1', 'preview-g1-none');
    const old = auth.exchange(token);
    if (isAuthError(old)) throw new Error(old.code);
    auth.reassignCredentials('pv1', 'preview-g1-none', 'preview-g2-none');
    expect(auth.currentCredential('pv1', 'preview-g2-none')?.token).toBe(token);
    expect(auth.currentCredential('pv1', 'preview-g1-none')).toBeNull();
    expect(auth.authenticate(old.id)).toBeNull();
    const again = auth.exchange(token);
    expect(isAuthError(again) ? 'err' : again.principal.id).toBe('preview-g2-none');
  });
});
