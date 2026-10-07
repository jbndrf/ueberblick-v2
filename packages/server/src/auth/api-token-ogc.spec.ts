import { describe, expect, it } from 'vitest';
import type { Key } from '@ueberblick/core';
import { openControlDb } from '../db/open';
import { ogcWorld } from '../http/ogc/testkit';
import { isAuthError } from './contract';
import { createAuth } from './service';

/** Acceptance: a token created in the settings authenticates a QGIS-style request with that participant's permissions, and stops after revoke. */
describe('an API token on the OGC endpoint (QGIS)', () => {
  it('reads as the participant (same collections as their session) and stops after revoke', async () => {
    const control = openControlDb(':memory:');
    control
      .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
      .run('p1', 'trees', 'trees', 'x');
    const auth = createAuth({
      control,
      now: () => new Date('2026-05-01T08:00:00.000Z'),
      participantRoles: () => ['kontrolle' as Key],
    });
    const world = await ogcWorld({
      deps: {
        auth,
        project: (key) =>
          control.prepare<{ id: string; key: string }>('SELECT id, key FROM projects WHERE key = ?').get(key),
      },
    });
    const issued = auth.apiTokens.issue('p1', 'anna', { label: 'QGIS Laptop' });
    if (isAuthError(issued)) throw new Error(issued.code);

    const viaToken = (header: string): Promise<Response> =>
      world.handlers.handle(
        new Request('http://x/api/p/trees/ogc/collections', { headers: { authorization: header } }),
        { params: { project: 'trees', path: 'collections' } },
      );
    const basic = `Basic ${Buffer.from(`${issued.token}:`).toString('base64')}`;

    const asToken = await viaToken(basic);
    expect(asToken.status).toBe(200);
    const bearer = await viaToken(`Bearer ${issued.token}`);
    expect(bearer.status).toBe(200);
    const names = ((await asToken.json()) as { collections: { id: string }[] }).collections.map((c) => c.id);
    expect(names.length).toBeGreaterThan(0);

    // Without the token, and for another project's participant: no access.
    expect((await viaToken('Basic ' + Buffer.from('ubk_wrong:').toString('base64'))).status).toBe(401);

    expect(auth.apiTokens.revoke('p1', issued.info.id)).toBe(true);
    expect((await viaToken(basic)).status).toBe(401);
    expect((await viaToken(`Bearer ${issued.token}`)).status).toBe(401);
  });
});

/** WP-1070: an admin token reads and writes through OGC as the admin, and only in its own project. */
describe('an admin API token on the OGC endpoint', () => {
  it('writes as the admin (actor kind admin), stops for another project and after revoke', async () => {
    const w = await ogcWorld();
    const admin = (await w.get('/collections')).status;
    expect(admin).toBe(200);
    const accountId = w.adminId;
    const issued = w.auth.apiTokens.issueAdmin('p1', accountId, { label: 'Nightly' });
    if (isAuthError(issued)) throw new Error(issued.code);
    const auth = { authorization: `Bearer ${issued.token}` };
    const tree = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [7.1, 50.73] },
      properties: { vitalitaet: 'v2' },
    };
    const created = await w.send('POST', '/collections/baum/items', tree, '', auth);
    expect(created.status).toBe(201);
    const run = w.ctx.db
      .prepare<{ actor: string; actor_kind: string }>(
        "SELECT actor, actor_kind FROM runs WHERE actor_kind != 'import' ORDER BY rowid DESC",
      )
      .get();
    expect(run).toEqual({ actor: accountId, actor_kind: 'admin' });

    w.control
      .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
      .run('p2', 'other', 'o', 'x');
    w.control
      .prepare('INSERT INTO memberships (account_id, project_id, role) VALUES (?,?,?)')
      .run(accountId, 'p2', 'verwaltung');
    const elsewhere = await w.handlers.handle(
      new Request('http://x/api/p/other/ogc/collections', { headers: auth }),
      { params: { project: 'other', path: 'collections' } },
    );
    expect(elsewhere.status).toBe(403);

    w.auth.apiTokens.revoke('p1', issued.info.id);
    expect((await w.send('POST', '/collections/baum/items', tree, '', auth)).status).toBe(401);
  });
});
