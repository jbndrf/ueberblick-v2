import { describe, expect, it } from 'vitest';
import { FEATURE, chatWorld } from './chat.testkit';

interface Listing {
  messages: {
    id: string;
    seq: number;
    author: string;
    body: string;
    mentions: { persons: string[]; features: string[] };
  }[];
  head: number;
  members: { id: string; name: string }[];
  read: { last_read_seq: number; last_mention_seq: number };
}
const listing = async (r: Response): Promise<Listing> => (await r.json()) as Listing;
const code = async (r: Response): Promise<string> =>
  ((await r.json()) as { error: { code: string } }).error.code;
const ID = (n: number): string => `msg-${String(n).padStart(8, '0')}`;

describe('access', () => {
  it('a role with the tool offered or active reads and writes', async () => {
    const w = await chatWorld();
    expect((await w.send(w.cookies.mia, ID(1), 'hallo')).status).toBe(201); // offered
    expect((await w.request('list', { cookie: w.cookies.lena })).status).toBe(200); // active
  });

  it('is 404, like a pack file, for: a role that lists other tools, an admin, another project, an unknown tool, no deployed config', async () => {
    const w = await chatWorld();
    expect((await w.request('list', { cookie: w.cookies.otto })).status).toBe(404);
    expect((await w.send(w.cookies.otto, ID(1), 'x')).status).toBe(404);
    expect((await w.request('read', { cookie: w.cookies.otto, body: { last_read_seq: 0 } })).status).toBe(
      404,
    );
    expect((await w.request('list', { cookie: w.cookies.admin })).status).toBe(404);
    expect((await w.request('list', { cookie: w.cookies.zoe })).status).toBe(404); // participant of another project
    expect((await w.request('list', { cookie: w.cookies.mia, tool: 'measure' })).status).toBe(404);
    const none = await chatWorld({ deployed: false });
    expect((await none.request('list', { cookie: none.cookies.mia })).status).toBe(404);
  });

  it('a role without app.tools gets the project tools, active, as the device shell does (one rule, core toolAvailabilityFor)', async () => {
    const w = await chatWorld();
    w.setTools(undefined);
    expect((await w.request('list', { cookie: w.cookies.lena })).status).toBe(200);
    w.setTools(undefined, { projectTools: {} });
    expect((await w.request('list', { cookie: w.cookies.lena })).status).toBe(404); // the project does not declare chat
  });

  it('is 401 without a session', async () => {
    const w = await chatWorld();
    expect((await w.request('list')).status).toBe(401);
  });
});

describe('send', () => {
  it('is idempotent by client id: a replay answers 200 with the stored message and writes and rings nothing', async () => {
    const w = await chatWorld();
    const first = await w.send(w.cookies.mia, ID(1), 'hallo');
    expect(first.status).toBe(201);
    const m1 = ((await first.json()) as { message: { seq: number; at: string } }).message;
    const again = await w.send(w.cookies.mia, ID(1), 'hallo');
    expect(again.status).toBe(200);
    expect(((await again.json()) as { message: { seq: number } }).message.seq).toBe(m1.seq);
    expect(w.rang).toEqual(['trees:chat']);
    expect((await listing(await w.request('list', { cookie: w.cookies.mia }))).messages).toHaveLength(1);
  });

  it("another person's client id is a conflict, not an overwrite", async () => {
    const w = await chatWorld();
    await w.send(w.cookies.mia, ID(1), 'mine');
    const r = await w.send(w.cookies.bernd, ID(1), 'yours');
    expect(r.status).toBe(409);
    expect((await listing(await w.request('list', { cookie: w.cookies.mia }))).messages[0]?.body).toBe(
      'mine',
    );
  });

  it('takes the author from the session, never from the body', async () => {
    const w = await chatWorld();
    const r = await w.request('send', {
      cookie: w.cookies.mia,
      body: { id: ID(1), body: 'x', author: 'bernd' },
    });
    expect(r.status).toBe(400);
    await w.send(w.cookies.mia, ID(2), 'x');
    expect((await listing(await w.request('list', { cookie: w.cookies.mia }))).messages[0]?.author).toBe(
      'mia',
    );
  });

  it('enforces the body: 4000 characters are fine, 4001, empty and blank are 400 invalid_body', async () => {
    const w = await chatWorld();
    expect((await w.send(w.cookies.mia, ID(1), 'a'.repeat(4000))).status).toBe(201);
    for (const [i, body] of [
      [2, 'a'.repeat(4001)],
      [3, ''],
      [4, '   '],
    ] as const) {
      const r = await w.send(w.cookies.mia, ID(i), body);
      expect(r.status).toBe(400);
      expect(await code(r)).toBe('invalid_body');
    }
    for (const body of [{ body: 'x' }, { id: 'short', body: 'x' }, { id: ID(9), body: 5 }, 'text']) {
      expect((await w.request('send', { cookie: w.cookies.mia, body })).status).toBe(400);
    }
    expect((await listing(await w.request('list', { cookie: w.cookies.mia }))).messages).toHaveLength(1);
  });

  it('re-extracts mentions: known people and features are indexed, unknown, hidden and duplicate ids are dropped, the text stays', async () => {
    const w = await chatWorld();
    const body = `@bernd @bernd @nobody @ghost #${FEATURE} #nofeature mail a@lena.de`;
    await w.send(w.cookies.mia, ID(1), body);
    const m = (await listing(await w.request('list', { cookie: w.cookies.mia }))).messages[0];
    expect(m?.mentions).toEqual({ persons: ['bernd'], features: [FEATURE] });
    expect(m?.body).toBe(body);
  });
});

describe('list', () => {
  it('pages by seq: after and limit, oldest first, with the head and the caller read state', async () => {
    const w = await chatWorld();
    for (let i = 1; i <= 5; i++) await w.send(w.cookies.mia, ID(i), `m${i}`);
    const a = await listing(await w.request('list', { cookie: w.cookies.bernd, query: '?limit=2' }));
    expect(a.messages.map((m) => m.body)).toEqual(['m1', 'm2']);
    expect(a.head).toBe(5);
    const b = await listing(
      await w.request('list', { cookie: w.cookies.bernd, query: `?after=${a.messages[1]?.seq}&limit=10` }),
    );
    expect(b.messages.map((m) => m.body)).toEqual(['m3', 'm4', 'm5']);
    expect(b.read).toEqual({ last_read_seq: 0, last_mention_seq: 0 });
    const end = await listing(await w.request('list', { cookie: w.cookies.bernd, query: '?after=5' }));
    expect(end.messages).toEqual([]);
  });

  it('lists the members of the tool, names only: every visible participant whose role has it (v3 mentionable-participants), by name', async () => {
    const w = await chatWorld();
    const a = await listing(await w.request('list', { cookie: w.cookies.mia }));
    // otto's role lists other tools, ghost is hidden, gone is disabled; a person without a name shows by id
    expect(a.members).toEqual([
      { id: 'anon', name: 'anon' },
      { id: 'bernd', name: 'Bernd' },
      { id: 'lena', name: 'Lena' },
      { id: 'mia', name: 'Mia' },
    ]);
    expect(Object.keys(a.members[0] ?? {}).sort()).toEqual(['id', 'name']);
    // the same list on a later page, so a device keeps it fresh with the stream
    await w.send(w.cookies.mia, ID(1), 'hi');
    const b = await listing(await w.request('list', { cookie: w.cookies.lena, query: '?after=1' }));
    expect(b.members).toEqual(a.members);
  });

  it('a role without the tool is not a member, and when the project drops the tool nobody lists', async () => {
    const w = await chatWorld();
    w.setTools({ chat: { availability: 'active' }, measure: {} });
    const a = await listing(await w.request('list', { cookie: w.cookies.mia }));
    expect(a.members.map((m) => m.id)).toEqual(['anon', 'bernd', 'lena', 'mia']);
    expect((await w.request('list', { cookie: w.cookies.otto })).status).toBe(404);
  });

  it('is 400 invalid_query for a bad or unknown parameter', async () => {
    const w = await chatWorld();
    for (const q of ['?after=-1', '?after=x', '?limit=0', '?limit=501', '?since=1']) {
      const r = await w.request('list', { cookie: w.cookies.mia, query: q });
      expect(r.status).toBe(400);
      expect(await code(r)).toBe('invalid_query');
    }
  });
});

describe('read state', () => {
  it('only grows, never passes the head, and is per person', async () => {
    const w = await chatWorld();
    for (let i = 1; i <= 3; i++) await w.send(w.cookies.mia, ID(i), `m${i}`);
    const read = async (cookie: string, body: unknown) =>
      ((await (await w.request('read', { cookie, body })).json()) as { read: Listing['read'] }).read;
    expect(await read(w.cookies.bernd, { last_read_seq: 2, last_mention_seq: 1 })).toEqual({
      last_read_seq: 2,
      last_mention_seq: 1,
    });
    expect(await read(w.cookies.bernd, { last_read_seq: 1 })).toEqual({
      last_read_seq: 2,
      last_mention_seq: 1,
    });
    expect(await read(w.cookies.bernd, { last_read_seq: 99, last_mention_seq: 99 })).toEqual({
      last_read_seq: 3,
      last_mention_seq: 3,
    });
    expect((await listing(await w.request('list', { cookie: w.cookies.bernd }))).read.last_read_seq).toBe(3);
    expect((await listing(await w.request('list', { cookie: w.cookies.lena }))).read.last_read_seq).toBe(0);
  });

  it('is 400 for a negative, fractional or missing mark', async () => {
    const w = await chatWorld();
    for (const body of [{ last_read_seq: -1 }, { last_read_seq: 1.5 }, {}, { last_read_seq: 1, extra: 1 }]) {
      const r = await w.request('read', { cookie: w.cookies.mia, body });
      expect(r.status).toBe(400);
      expect(await code(r)).toBe('invalid_body');
    }
  });
});

describe('doorbell', () => {
  it('rings once per accepted message with the tool key only, and not for a refused one', async () => {
    const w = await chatWorld();
    await w.send(w.cookies.mia, ID(1), 'ok');
    await w.send(w.cookies.mia, ID(2), '');
    await w.send(w.cookies.otto, ID(3), 'nope');
    expect(w.rang).toEqual(['trees:chat']);
  });
});
