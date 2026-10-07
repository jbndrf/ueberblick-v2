import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@ueberblick/server';
import type * as AuthzModule from './authz';

// The REAL authorizeAdmin over the real runtime (WP-175): no stub of the membership lookup.
const dir = mkdtempSync(join(tmpdir(), 'ub-authz-'));
let authorizeAdmin: (typeof AuthzModule)['authorizeAdmin'];
let stop: () => void = () => undefined;
let adminA: Principal;
const status = (r: unknown): number => (r instanceof Response ? r.status : 200);

beforeAll(async () => {
  process.env['PUBLIC_URL'] = 'http://localhost:3000';
  process.env['DATA_DIR'] = dir;
  process.env['TIMERS_INTERVAL_S'] = '0';
  const { runtime } = await import('./runtime');
  ({ authorizeAdmin } = await import('./authz'));
  const rt = runtime();
  stop = () => rt.stop();
  for (const key of ['alpha', 'beta'])
    rt.control
      .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
      .run(`id-${key}`, key, key, 'x');
  const accountId = await rt.auth.createAdmin('a@example.org', 'correct horse battery');
  rt.control
    .prepare('INSERT INTO memberships (account_id, project_id, role) VALUES (?,?,?)')
    .run(accountId, 'id-alpha', 'verwaltung');
  adminA = { kind: 'admin', id: accountId, projectId: null, roles: [] };
});

afterAll(() => {
  stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('authorizeAdmin (real)', () => {
  it('accepts an admin on the project they belong to', () => {
    const r = authorizeAdmin(adminA, 'alpha');
    expect(status(r)).toBe(200);
    expect(r).toMatchObject({ projectKey: 'alpha' });
  });
  it('refuses an admin of project A on project B with 403', () => {
    expect(status(authorizeAdmin(adminA, 'beta'))).toBe(403);
  });
  it('gives 404 for an unknown project, 401 without a principal, 403 for a participant', () => {
    expect(status(authorizeAdmin(adminA, 'nope'))).toBe(404);
    expect(status(authorizeAdmin(null, 'alpha'))).toBe(401);
    expect(status(authorizeAdmin({ ...adminA, kind: 'participant' }, 'alpha'))).toBe(403);
  });
});
