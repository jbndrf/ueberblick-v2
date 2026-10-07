import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { SESSION_PARTICIPANT_HEADER, SYNC_PROTOCOL_VERSION, type Actor, type Key } from '@ueberblick/core';
import { describe, expect, it } from 'vitest';
import { streamBody } from './gzip';
import { anna, decodePage, IDS, setupHttp, type Http } from './testkit';

const url = (q: string): string => `http://x/api/p/demo/sync?${q}`;
const get = (
  h: Http,
  q: string,
  who: Parameters<Http['handlers']['sync']>[0]['principal'] = h.anna,
  headers: Record<string, string> = {},
): Response =>
  h.handlers.sync({ request: new Request(url(q), { headers }), project: 'demo', principal: who });

async function pageOf(res: Response) {
  const buf = Buffer.from(await res.arrayBuffer());
  const text =
    res.headers.get('content-encoding') === 'gzip' ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  return decodePage(JSON.parse(text) as unknown);
}

describe('GET sync', () => {
  it('answers a snapshot page as gzip tuples that decode to the service page', async () => {
    const h = setupHttp();
    const res = get(h, `since=0&scope=&v=${SYNC_PROTOCOL_VERSION}`, h.anna, { 'accept-encoding': 'gzip' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('gzip');
    const page = await pageOf(res);
    expect(page.header.kind).toBe('snapshot');
    expect(page.features.map((f) => f.id).sort()).toEqual(
      h.ctx.service
        .page(h.annaActor, { since: 0, scope: '', v: SYNC_PROTOCOL_VERSION })
        .features.map((f) => f.id)
        .sort(),
    );
    expect(page.features.length).toBeGreaterThan(0);
  });

  it('sends plain JSON when the caller does not accept gzip', async () => {
    const h = setupHttp();
    const res = get(h, `since=0&scope=&v=${SYNC_PROTOCOL_VERSION}`);
    expect(res.headers.get('content-encoding')).toBeNull();
    expect((await pageOf(res)).features.length).toBeGreaterThan(0);
  });

  it('refuses anonymous callers, foreign projects and unknown projects', () => {
    const h = setupHttp();
    expect(get(h, `since=0&scope=&v=${SYNC_PROTOCOL_VERSION}`, null).status).toBe(401);
    expect(
      get(h, `since=0&scope=&v=${SYNC_PROTOCOL_VERSION}`, { ...h.anna, projectId: 'other' }).status,
    ).toBe(403);
    const res = h.handlers.sync({
      request: new Request(url(`since=0&v=${SYNC_PROTOCOL_VERSION}`)),
      project: 'nope',
      principal: h.anna,
    });
    expect(res.status).toBe(404);
    const admin = { kind: 'admin' as const, id: 'a', projectId: null, roles: [] };
    expect(get(h, `since=0&scope=&v=${SYNC_PROTOCOL_VERSION}`, admin).status).toBe(403); // no membership
    expect(get(h, `since=0&scope=&v=${SYNC_PROTOCOL_VERSION}`, { ...admin, id: 'member' }).status).toBe(200);
  });

  it('with a participant and an admin session the participant answers; the admin is the fallback (WP-705)', async () => {
    const h = setupHttp();
    const q = `since=0&scope=&v=${SYNC_PROTOCOL_VERSION}`;
    const admin = { kind: 'admin' as const, id: 'member', projectId: null, roles: [] };
    const adminActor: Actor = { id: 'member', kind: 'admin', roles: ['verwaltung' as Key] };
    const ids = (a: Actor): string[] =>
      h.ctx.service
        .page(a, { since: 0, scope: '', v: SYNC_PROTOCOL_VERSION })
        .features.map((f) => f.id)
        .sort();
    const sync = (principal: typeof h.anna | null, fallback: typeof admin | null) =>
      h.handlers.sync({ request: new Request(url(q)), project: 'demo', principal, fallback });
    const served = async (res: Response): Promise<{ actor: string | number | undefined; ids: string[] }> => {
      const page = await pageOf(res);
      return {
        actor: h.logs.only('sync.served').at(-1)?.['actor'],
        ids: page.features.map((f) => f.id).sort(),
      };
    };
    // right project: the participant answers, with the participant's clipped page
    expect(await served(sync(h.anna, admin))).toEqual({ actor: 'anna', ids: ids(h.annaActor) });
    // another project's participant: the admin answers, with the admin's page
    expect(await served(sync({ ...h.anna, projectId: 'other' }, admin))).toEqual({
      actor: 'member',
      ids: ids(adminActor),
    });
    expect(sync({ ...h.anna, projectId: 'other' }, null).status).toBe(403);
    expect(sync(null, null).status).toBe(401);
  });

  it('sync/events: the fallback admin answers only when the participant may not (WP-705)', () => {
    const h = setupHttp();
    const events = (principal: typeof h.anna | null, fallback: { id: string } | null) => {
      const abort = new AbortController();
      const res = h.handlers.events({
        request: new Request('http://x/e', { signal: abort.signal }),
        project: 'demo',
        principal,
        fallback: fallback === null ? null : { kind: 'admin', id: fallback.id, projectId: null, roles: [] },
      });
      abort.abort();
      return res.status;
    };
    const other = { ...h.anna, projectId: 'other' };
    expect(events(other, { id: 'member' })).toBe(200); // admin with a role answers
    expect(events(other, { id: 'nobody' })).toBe(403); // admin without a role: refused
    expect(events(h.anna, { id: 'nobody' })).toBe(200); // the participant answers, the roleless admin is never needed
    expect(events(null, null)).toBe(401);
  });

  it('answers a typed error for a wrong protocol version or a malformed query', async () => {
    const h = setupHttp();
    const v = get(h, 'since=0&scope=&v=99');
    expect(v.status).toBe(409);
    expect(await v.json()).toMatchObject({ code: 'version_mismatch' });
    const m = get(h, `since=x&scope=&v=${SYNC_PROTOCOL_VERSION}`);
    expect(m.status).toBe(400);
    expect(await m.json()).toMatchObject({ code: 'malformed' });
  });

  it('answers 409 no_config before the first deploy', async () => {
    const h = setupHttp({ deployed: false });
    const res = get(h, `since=0&scope=&v=${SYNC_PROTOCOL_VERSION}`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'no_config' });
  });

  it('honours limit and reports more', async () => {
    const h = setupHttp();
    const page = await pageOf(get(h, `since=0&scope=&v=${SYNC_PROTOCOL_VERSION}&limit=1`));
    expect(page.features).toHaveLength(1);
    expect(page.header.more).toBe(true);
  });
});

describe('GET sync/events (doorbell)', () => {
  it('rings on a committed run, with the seq range and nothing else', async () => {
    const h = setupHttp();
    const abort = new AbortController();
    const res = h.handlers.events({
      request: new Request('http://x/api/p/demo/sync/events', { signal: abort.signal }),
      project: 'demo',
      principal: h.anna,
    });
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    const hello = decoder.decode((await reader.read()).value);
    expect(hello).toContain('event: hello');

    const head = h.ctx.service.head();
    const result = h.store.submit(
      h.ctx.run('kontrolle', anna, { vitalitaet: 'v3', befund: 'Bell' }, IDS.t_in),
    );
    expect(result.outcome).toBe('accepted');
    const msg = decoder.decode((await reader.read()).value);
    expect(msg.startsWith('event: seq\ndata: ')).toBe(true);
    const data = JSON.parse(msg.split('data: ')[1] as string) as Record<string, number>;
    expect(Object.keys(data).sort()).toEqual(['from', 'head', 'to']);
    expect(data['from']).toBe(head + 1);
    expect(data['to']).toBe(h.ctx.service.head());
    abort.abort();
    expect(h.bell.listeners).toBe(0);
  });

  it('writes `event: tool` with the tool key only when a tool stream rang, and stops listening on abort', async () => {
    const h = setupHttp();
    const abort = new AbortController();
    const res = h.handlers.events({
      request: new Request('http://x/api/p/demo/sync/events', { signal: abort.signal }),
      project: 'demo',
      principal: h.anna,
    });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    await reader.read(); // hello
    h.toolBell.ring('other', 'chat'); // another project: not heard
    h.toolBell.ring('demo', 'chat');
    expect(decoder.decode((await reader.read()).value)).toBe('event: tool\ndata: {"tool":"chat"}\n\n');
    abort.abort();
    h.toolBell.ring('demo', 'chat'); // no listener left: must not throw
  });

  it('sends a heartbeat comment when idle, and refuses anonymous callers', async () => {
    const h = setupHttp({ heartbeatMs: 20 });
    expect(
      h.handlers.events({ request: new Request('http://x/e'), project: 'demo', principal: null }).status,
    ).toBe(401);
    const abort = new AbortController();
    const res = h.handlers.events({
      request: new Request('http://x/e', { signal: abort.signal }),
      project: 'demo',
      principal: h.anna,
    });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await reader.read(); // hello
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(': heartbeat\n\n');
    abort.abort();
  });

  it('a refused run does not ring', async () => {
    const h = setupHttp();
    const seen: unknown[] = [];
    const off = h.bell.subscribe((m) => seen.push(m));
    const refused = h.store.submit(
      h.ctx.run('kontrolle', anna, { vitalitaet: 'v2', befund: 'unauffällig' }, IDS.t_in),
    );
    expect(refused.outcome).toBe('refused');
    expect(seen).toEqual([]);
    off();
  });
});

describe('streams that a client drops', () => {
  it('an event stream whose request is aborted before start subscribes to nothing (no leak)', () => {
    const h = setupHttp({ heartbeatMs: 5 });
    const abort = new AbortController();
    abort.abort();
    const res = h.handlers.events({
      request: new Request('http://x/api/p/demo/sync/events', { signal: abort.signal }),
      project: 'demo',
      principal: h.anna,
    });
    expect(res.status).toBe(200);
    expect(h.bell.listeners).toBe(0);
  });

  it('cancelling a page download destroys the source, gzip or not', async () => {
    for (const gzip of [true, false]) {
      let produced = 0;
      const source = new Readable({
        read() {
          produced++;
          this.push(Buffer.alloc(16_384, 'x'));
        },
      });
      const closed = new Promise<void>((resolve) => source.once('close', resolve));
      const reader = streamBody(source, gzip).getReader();
      await reader.read();
      await reader.cancel();
      await closed;
      expect(source.destroyed).toBe(true);
      const at = produced;
      await new Promise((r) => setTimeout(r, 20));
      expect(produced).toBe(at); // nothing keeps pulling
    }
  });
});

describe('the session participant (WP-768)', () => {
  const q = `since=0&scope=&v=${SYNC_PROTOCOL_VERSION}`;
  it('every page names the session participant, plain and gzipped', () => {
    const h = setupHttp();
    expect(get(h, q).headers.get(SESSION_PARTICIPANT_HEADER)).toBe('anna');
    const gz = get(h, q, h.anna, { 'accept-encoding': 'gzip' });
    expect(gz.headers.get(SESSION_PARTICIPANT_HEADER)).toBe('anna');
    expect(get(h, q, h.anna, { [SESSION_PARTICIPANT_HEADER]: 'anna' }).status).toBe(200);
  });

  it('a request made as another participant is a 409 session_changed and sends no data', async () => {
    const h = setupHttp();
    const res = get(h, q, h.anna, { [SESSION_PARTICIPANT_HEADER]: 'olga' });
    expect(res.status).toBe(409);
    expect(res.headers.get(SESSION_PARTICIPANT_HEADER)).toBe('anna');
    expect(await res.json()).toMatchObject({ code: 'session_changed' });
  });
});
