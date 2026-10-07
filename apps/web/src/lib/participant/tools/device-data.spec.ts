import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import type { IdbEnv } from '@ueberblick/client';
import type { Key, TemplateFile } from '@ueberblick/core/model';
import { openDeviceToolData, type DeviceToolData, type DeviceToolDataDeps } from './device-data';

/** A server that speaks WP-682's wire for the chat route and records what it was asked. */
function server() {
  const state = { seen: [] as string[], messages: [] as unknown[], head: 0 };
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    state.seen.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.startsWith('/api/p/demo/tools/chat/read'))
      return Response.json({ read: { last_read_seq: 0, last_mention_seq: 0 } });
    if (url.startsWith('/api/p/demo/tools/chat') && init?.method === 'POST') {
      const b = JSON.parse(String(init.body)) as { id: string; body: string };
      const message = {
        id: b.id,
        seq: ++state.head,
        author: 'vera',
        at: '2026-10-02T08:00:00.000Z',
        body: b.body,
        removed: false,
        mentions: { persons: [], features: [] },
      };
      state.messages.push(message);
      return Response.json({ message }, { status: 201 });
    }
    if (url.startsWith('/api/p/demo/tools/chat'))
      return Response.json({
        messages: state.messages,
        head: state.head,
        read: { last_read_seq: 0, last_mention_seq: 0 },
      });
    return new Response('{}', { status: 404 });
  };
  return { state, fetch };
}

const file = (chat: unknown, roleTools?: Record<string, unknown>) =>
  ({
    tools: { measure: {}, ...(chat === undefined ? {} : { chat }) },
    roles: { verwaltung: { label: 'V', app: roleTools === undefined ? {} : { tools: roleTools } } },
  }) as unknown as TemplateFile;

const opened: DeviceToolData[] = [];
afterEach(() => opened.splice(0).forEach((d) => d.close()));

async function open(f: TemplateFile | undefined, over: Partial<DeviceToolDataDeps> = {}) {
  const s = server();
  const idb = { factory: new IDBFactory(), keyRange: IDBKeyRange } as unknown as IdbEnv;
  const errors: unknown[] = [];
  const timers: { fn: () => void }[] = [];
  const data = await openDeviceToolData({
    name: 'ub-demo-vera',
    project: 'demo',
    roles: ['verwaltung' as Key],
    file: () => f,
    fetch: s.fetch,
    idb,
    clock: { now: () => '2026-10-02T08:00:00.000Z' as never },
    newId: () => `id-${Math.random().toString(36).slice(2, 10)}`,
    timers: { set: (fn) => (timers.push({ fn }), timers.length), clear: () => {} },
    locks: undefined,
    doorbell: { subscribe: () => () => {} },
    self: () => 'vera',
    onError: (e) => void errors.push(e),
    ...over,
  });
  opened.push(data);
  return { ...data, s, errors, idb };
}

describe('openDeviceToolData (the device boot of the tool streams, WP-684)', () => {
  it("pulls the chat stream only when the role has the tool (core's one availability rule)", async () => {
    const yes = await open(file({}, { chat: { availability: 'offered' } }));
    await yes.service.sync();
    expect(yes.s.state.seen).toContain('GET /api/p/demo/tools/chat?after=0&limit=100');

    const none = await open(file({}, { measure: {} })); // the role lists tools without chat
    await none.service.sync();
    expect(none.s.state.seen).toEqual([]);

    const undeclared = await open(file(undefined));
    await undeclared.service.sync();
    expect(undeclared.s.state.seen).toEqual([]);
  });

  it('a role with no app.tools has a declared chat, active', async () => {
    const d = await open(file({}));
    await d.service.sync();
    expect(d.s.state.seen.some((x) => x.includes('/tools/chat'))).toBe(true);
  });

  it('knows no stream before the config is on the device', async () => {
    const d = await open(undefined);
    await d.service.sync();
    expect(d.s.state.seen).toEqual([]);
  });

  it('an append is sent at once through the outbox (kick), and the mirror survives a reopen', async () => {
    const d = await open(file({}));
    await d.service.handle('chat').append('Moin');
    await new Promise((r) => setTimeout(r, 30));
    expect(d.s.state.seen).toContain('POST /api/p/demo/tools/chat');
    await d.service.pull('chat');
    expect(
      d.service
        .handle('chat')
        .items()
        .map((i) => i.body),
    ).toEqual(['Moin']);
    d.close();
    const again = await open(file({}), { idb: d.idb, fetch: d.s.fetch });
    expect(
      again.service
        .handle('chat')
        .items()
        .map((i) => i.body),
    ).toEqual(['Moin']);
  });

  it('the tool host gets a port only for a tool the person has, and its read mark reaches the badge at once', async () => {
    const d = await open(file({}));
    expect(d.source.forTool('chat')).toBeDefined();
    expect(d.source.forTool('search')).toBeUndefined();
    expect(d.source.forTool('chat')).toBe(d.source.forTool('chat')); // one port per tool
    const none = await open(file({}, { measure: {} }));
    expect(none.source.forTool('chat')).toBeUndefined();
  });

  it('gives the shell the badges of its data tools', async () => {
    const d = await open(file({}));
    expect(d.badges.current()).toEqual({ chat: { hard: 0, soft: false } });
  });
});

describe('the device and the server agree on which tools have a stream', () => {
  it("the manifest's data tools are the server's STREAM_TOOLS", async () => {
    const { STREAM_TOOLS } = await import('@ueberblick/server');
    const { dataToolKeys } = await import('./manifest');
    expect([...dataToolKeys()].sort()).toEqual([...STREAM_TOOLS.keys].sort());
  }, 60_000); // the server package is a big import
});
