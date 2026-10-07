import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '../../auth/contract';
import { isAuthError } from '../../auth/contract';
import { createParticipantHandlers, type ParticipantCall } from './handlers';
import { importParticipant } from './roster';
import { world } from './testkit';

const admin: Principal = { kind: 'admin', id: 'a1', projectId: null, roles: [] };
const participant: Principal = { kind: 'participant', id: 'p', projectId: 'id-demo', roles: [] };

/** Admin membership per project key: a1 is in `demo` only, a2 in `other` only (like `authorizeAdmin`'s rolesFor check). */
const MEMBERS: Readonly<Record<string, readonly string[]>> = { a1: ['demo'], a2: ['other'] };
const adminOther: Principal = { kind: 'admin', id: 'a2', projectId: null, roles: [] };

function setup() {
  const w = world();
  const ctxKeys: string[] = [];
  const handlers = createParticipantHandlers({
    authorizeAdmin: (p, key) => {
      if (p === null) return new Response('{}', { status: 401 });
      if (p.kind !== 'admin') return new Response('{}', { status: 403 });
      if (!MEMBERS[p.id]?.includes(key)) return new Response('{}', { status: 403 });
      return { projectKey: key };
    },
    ctx: (key) => {
      ctxKeys.push(key);
      return w.ctx;
    },
  });
  const call = (
    principal: Principal | null,
    opts: { body?: unknown; site?: string; params?: Record<string, string> } = {},
  ): ParticipantCall => ({
    principal,
    params: { project: 'demo', ...opts.params },
    request: new Request('http://x/', {
      method: 'POST',
      headers:
        opts.site === undefined ? { 'sec-fetch-site': 'same-origin' } : { 'sec-fetch-site': opts.site },
      body: opts.body === undefined ? null : JSON.stringify(opts.body),
    }),
  });
  return { ...w, handlers, call, ctxKeys };
}

describe('participant handlers', () => {
  it('an admin of another project is refused on every route, and ctx gets the authorised key', async () => {
    const { handlers, call, ctxKeys, db, ctx } = setup();
    const params = { id: 'anna' };
    importParticipant(ctx, { id: 'anna', roles: ['kontrolle'] });
    await handlers.list(call(admin));
    expect(ctxKeys).toEqual(['demo']);
    ctxKeys.length = 0;
    const attempts = {
      list: { params },
      add: { body: { id: 'mallory', roles: [] }, params },
      update: { body: { roles: ['verwaltung'] }, params },
      remove: { params },
      credGet: { params },
      credSet: { params },
      qrIssue: { params },
      credRevoke: { params },
      selfJoinList: { params },
      selfJoinSet: { body: { enabled: true }, params: { role: 'melder' } },
    } as const;
    for (const [name, opts] of Object.entries(attempts)) {
      const h = handlers[name as keyof typeof attempts];
      expect((await h(call(adminOther, opts))).status, name).toBe(403);
    }
    expect(ctxKeys).toEqual([]);
    const rows = db.prepare('SELECT id, roles, disabled_at FROM participants').all();
    expect(rows).toEqual([{ id: 'anna', roles: '["kontrolle"]', disabled_at: null }]);
    // The same admin acts on its own project: ctx resolves that key.
    expect((await handlers.list(call(adminOther, { params: { project: 'other' } }))).status).toBe(200);
    expect(ctxKeys).toEqual(['other']);
  });

  it('a non-admin or anonymous caller is refused', async () => {
    const { handlers, call } = setup();
    for (const h of Object.values(handlers)) {
      expect((await h(call(participant, { params: { id: 'x' } }))).status).toBe(403);
      expect((await h(call(null, { params: { id: 'x' } }))).status).toBe(401);
    }
  });

  it('a change from another origin, or without the header, is refused; a read is not', async () => {
    const { handlers, call } = setup();
    const body = { name: 'Anna', roles: [] };
    expect((await handlers.add(call(admin, { body, site: 'cross-site' }))).status).toBe(403);
    expect((await handlers.add(call(admin, { body, site: 'none' }))).status).toBe(403);
    expect((await handlers.qrIssue(call(admin, { site: 'cross-site', params: { id: 'anna' } }))).status).toBe(
      403,
    );
    expect((await handlers.list(call(admin, { site: 'cross-site' }))).status).toBe(200);
  });

  it('runs the whole flow: add, issue, read the token back, exchange, revoke', async () => {
    const { handlers, call, auth } = setup();
    const added = await handlers.add(call(admin, { body: { name: 'Anna', roles: ['kontrolle'] } }));
    expect(added.status).toBe(201);
    const { id } = (await added.json()) as { id: string };
    expect(id).toMatch(/^anna-[0-9a-f]{6}$/);
    const issued = await handlers.qrIssue(call(admin, { params: { id } }));
    expect(issued.status).toBe(201);
    expect(issued.headers.get('cache-control')).toBe('no-store');
    const { token, expiresAt } = (await issued.json()) as { token: string; expiresAt: unknown };
    expect(expiresAt).toBeNull();
    const roster = await (await handlers.list(call(admin))).text();
    expect(roster).not.toContain(token);
    const s = auth.exchange(token);
    if (isAuthError(s)) throw new Error(s.code);
    expect(s.principal.roles).toEqual(['kontrolle']);
    expect((await handlers.credRevoke(call(admin, { params: { id } }))).status).toBe(200);
    expect(auth.authenticate(s.id)).toBeNull();
    expect((await handlers.qrIssue(call(admin, { params: { id: 'ghost' } }))).status).toBe(404);
  });

  describe('credentials: set, generate, read, revoke (WP-607)', () => {
    const id = { id: 'anna' };
    const put = (c: ReturnType<typeof setup>, body?: unknown) =>
      c.handlers.credSet(c.call(admin, { params: id, ...(body === undefined ? {} : { body }) }));
    const get = (c: ReturnType<typeof setup>) => c.handlers.credGet(c.call(admin, { params: id }));
    const withAnna = async () => {
      const c = setup();
      importParticipant(c.ctx, { id: 'anna', roles: ['kontrolle'] });
      importParticipant(c.ctx, { id: 'ben', roles: [] });
      return c;
    };

    it('sets a chosen token and reads it back with a url-encoded login link', async () => {
      const c = await withAnna();
      const r = await put(c, { token: 'Anna Tree/2026' });
      expect(r.status).toBe(400); // space and slash are outside the token rule
      const ok = await put(c, { token: 'anna-tree_2026' });
      expect(ok.status).toBe(200);
      expect(ok.headers.get('cache-control')).toBe('no-store');
      const got = (await (await get(c)).json()) as Record<string, unknown>;
      expect(got).toEqual({
        token: 'anna-tree_2026',
        link: '/login?token=anna-tree_2026',
        expiresAt: null,
        lastUsedAt: null,
      });
      const s = c.auth.exchange('anna-tree_2026');
      if (isAuthError(s)) throw new Error(s.code);
      expect(((await (await get(c)).json()) as { lastUsedAt: string }).lastUsedAt).toBe(
        '2026-01-01T00:00:00.000Z',
      );
    });

    it('the link url-encodes the token', async () => {
      const c = await withAnna();
      const body = { token: 'abcdefgh-ij_k' };
      await put(c, body);
      const got = (await (await get(c)).json()) as { link: string };
      expect(got.link).toBe(`/login?token=${encodeURIComponent('abcdefgh-ij_k')}`);
      const gen = await put(c);
      const { token, link } = (await gen.json()) as { token: string; link: string };
      expect(token).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/);
      expect(link).toBe(`/login?token=${encodeURIComponent(token)}`);
    });

    it('generates when no token is given and replaces the earlier one', async () => {
      const c = await withAnna();
      await put(c, { token: 'first-token-1' });
      const gen = (await (await put(c)).json()) as { token: string };
      expect(gen.token).not.toBe('first-token-1');
      expect(((await (await get(c)).json()) as { token: string }).token).toBe(gen.token);
      expect(c.auth.exchange('first-token-1')).toEqual({ code: 'credential_revoked' });
      expect(isAuthError(c.auth.exchange(gen.token))).toBe(false);
    });

    it('refuses a duplicate and a too-short token and changes nothing', async () => {
      const c = await withAnna();
      await put(c, { token: 'shared-token-1' });
      const dup = await c.handlers.credSet(
        c.call(admin, { params: { id: 'ben' }, body: { token: 'shared-token-1' } }),
      );
      expect(dup.status).toBe(409);
      expect(await dup.json()).toMatchObject({ error: 'token_duplicate' });
      const short = await put(c, { token: 'abc' });
      expect(short.status).toBe(400);
      expect(await short.json()).toMatchObject({ error: 'token_too_short' });
      expect(((await (await get(c)).json()) as { token: string }).token).toBe('shared-token-1');
      expect((await c.handlers.credGet(c.call(admin, { params: { id: 'ben' } }))).status).toBe(404);
    });

    it('setting the current token again only updates its expiry', async () => {
      const c = await withAnna();
      await put(c, { token: 'same-token-12' });
      const r = await put(c, { token: 'same-token-12', expiresAt: '2027-01-01T00:00:00.000Z' });
      expect(r.status).toBe(200);
      expect(((await r.json()) as { expiresAt: string }).expiresAt).toBe('2027-01-01T00:00:00.000Z');
      expect((await put(c, { token: 'same-token-12', expiresAt: '2020-01-01' })).status).toBe(400);
    });

    it('revoke makes the token unusable and the read 404', async () => {
      const c = await withAnna();
      await put(c, { token: 'revoke-me-123' });
      expect((await c.handlers.credRevoke(c.call(admin, { params: id }))).status).toBe(200);
      expect((await get(c)).status).toBe(404);
      expect(c.auth.exchange('revoke-me-123')).toEqual({ code: 'credential_revoked' });
    });

    it('non-admin 403, anonymous 401, cross-origin change 403, unknown participant 404', async () => {
      const c = await withAnna();
      for (const h of [c.handlers.credGet, c.handlers.credSet, c.handlers.credRevoke]) {
        expect((await h(c.call(participant, { params: id }))).status).toBe(403);
        expect((await h(c.call(null, { params: id }))).status).toBe(401);
      }
      expect((await c.handlers.credSet(c.call(admin, { params: id, site: 'cross-site' }))).status).toBe(403);
      expect((await c.handlers.credSet(c.call(admin, { params: { id: 'ghost' } }))).status).toBe(404);
      expect((await c.handlers.credGet(c.call(admin, { params: { id: 'ghost' } }))).status).toBe(404);
    });

    it('a malformed body is a 400', async () => {
      const c = await withAnna();
      expect((await put(c, { token: 5 })).status).toBe(400);
      expect((await put(c, [1])).status).toBe(400);
    });
  });

  it('the list route carries activeQrs per participant from one grouped query, not one call per participant', async () => {
    const { handlers, call, ctx } = setup();
    for (const id of ['anna', 'bernd', 'cora']) importParticipant(ctx, { id, roles: [] });
    await handlers.qrIssue(call(admin, { params: { id: 'anna' } }));
    await handlers.qrIssue(call(admin, { params: { id: 'anna' } }));
    await handlers.qrIssue(call(admin, { params: { id: 'bernd' } }));
    await handlers.update(call(admin, { params: { id: 'cora' }, body: { disabled: true } }));
    const count = vi.spyOn(ctx.auth, 'countActiveCredentials');
    const list = vi.spyOn(ctx.auth, 'listCredentials');
    const body = (await (await handlers.list(call(admin))).json()) as {
      participants: { id: string; activeQrs: number }[];
    };
    expect(body.participants.map((p) => [p.id, p.activeQrs])).toEqual([
      ['anna', 2],
      ['bernd', 1],
      ['cora', 0],
    ]);
    expect(count).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();
  });

  it('update and remove answer 200 and 404', async () => {
    const { handlers, call, ctx } = setup();
    importParticipant(ctx, { id: 'anna', roles: [] });
    expect(
      (await handlers.update(call(admin, { body: { roles: ['bauhof'] }, params: { id: 'anna' } }))).status,
    ).toBe(200);
    expect(
      (await handlers.update(call(admin, { body: { roles: 'x' }, params: { id: 'anna' } }))).status,
    ).toBe(400);
    expect((await handlers.remove(call(admin, { params: { id: 'anna' } }))).status).toBe(200);
    expect((await handlers.remove(call(admin, { params: { id: 'nobody' } }))).status).toBe(404);
  });

  it('add answers 400 with the v3 message when the name is empty, and 400 for an unknown role', async () => {
    const { handlers, call } = setup();
    const r = await handlers.add(call(admin, { body: { name: '  ', roles: [] } }));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({
      error: 'name_required',
      message: { en: 'Name is required', de: 'Name ist erforderlich' },
    });
    expect((await handlers.add(call(admin, { body: { roles: [] } }))).status).toBe(400);
  });

  it('add, update (E-Mail, Telefon, columns, disabled) and list with the guests switch', async () => {
    const { handlers, call, ctx } = setup();
    const cols = await handlers.columnsSet(
      call(admin, { body: { columns: [{ key: 'team', label: 'Team', type: 'text', default: 'Nord' }] } }),
    );
    expect(cols.status).toBe(200);
    expect(await (await handlers.columnsGet(call(admin))).json()).toEqual({
      columns: [{ key: 'team', label: 'Team', type: 'text', default: 'Nord', required: false }],
    });
    expect((await handlers.columnsSet(call(admin, { body: { columns: [{ key: 'x' }] } }))).status).toBe(400);
    expect(
      (
        await handlers.columnsSet(
          call(admin, { body: { columns: [{ key: 'email', label: 'E', type: 'text' }] } }),
        )
      ).status,
    ).toBe(400);
    const added = await handlers.add(
      call(admin, { body: { name: 'Anna', email: 'a@b.de', phone: '1', attrs: {} } }),
    );
    const { id } = (await added.json()) as { id: string };
    importParticipant(ctx, { id: 'gast', name: 'Gast', roles: [], selfJoined: true });
    const upd = await handlers.update(
      call(admin, { params: { id }, body: { phone: null, attrs: { team: 'Süd' }, disabled: true } }),
    );
    expect(upd.status).toBe(200);
    const list = async (q = '') => {
      const req = call(admin);
      const r = await handlers.list({ ...req, request: new Request(`http://x/${q}`) });
      return ((await r.json()) as { participants: { id: string }[] }).participants;
    };
    const all = (await list()) as unknown as Record<string, unknown>[];
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ email: 'a@b.de', phone: null, attrs: { team: 'Süd' }, selfJoined: false });
    expect(all[0]?.['disabledAt']).not.toBeNull();
    expect((await list('?guests=true')).map((p) => p.id)).toEqual([id, 'gast']);
    await handlers.update(call(admin, { params: { id }, body: { disabled: false } }));
    expect(((await list()) as unknown as Record<string, unknown>[])[0]?.['disabledAt']).toBeNull();
    expect((await handlers.update(call(admin, { params: { id }, body: { disabled: 'yes' } }))).status).toBe(
      400,
    );
  });
});

describe('self-join links (WP-639)', () => {
  it('an admin switches a role link on, lists it, and a bad change is refused', async () => {
    const { handlers, call } = setup();
    const set = (body: unknown) => handlers.selfJoinSet(call(admin, { body, params: { role: 'melder' } }));
    const on = await set({ enabled: true, slug: 'maengel-nord' });
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ role: 'melder', slug: 'maengel-nord', enabled: true });
    const list = await handlers.selfJoinList(call(admin));
    expect(await list.json()).toEqual({ links: [{ role: 'melder', slug: 'maengel-nord', enabled: true }] });
    expect((await set({ enabled: 'ja' })).status).toBe(400);
    expect((await set({ enabled: true, slug: 'A b' })).status).toBe(400);
    expect(
      (
        await handlers.selfJoinSet(
          call(admin, { body: { enabled: true, slug: 'maengel-nord' }, params: { role: 'andere' } }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await handlers.selfJoinSet(
          call(admin, { body: { enabled: true }, params: { role: 'melder' }, site: 'cross-site' }),
        )
      ).status,
    ).toBe(403);
  });
});
