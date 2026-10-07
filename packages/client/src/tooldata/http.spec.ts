import { describe, expect, it } from 'vitest';
import type { Seq } from '@ueberblick/core/model';
import { httpToolDataTransport } from './http';

const reply =
  (status: number, body: unknown = {}) =>
  async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const t = (status: number, body?: unknown) => httpToolDataTransport('p', reply(status, body) as typeof fetch);
const msg = (seq: number, over: Record<string, unknown> = {}) => ({
  id: `m${seq}`,
  seq,
  author: 'anna',
  at: '2026-10-02T08:00:00.000Z',
  body: `b${seq}`,
  removed: false,
  mentions: { persons: [], features: [] },
  ...over,
});

describe('http tool data transport', () => {
  it('maps 404 and 401, throws on 5xx', async () => {
    expect(await t(404).page('chat', 0 as Seq, 10)).toEqual({ kind: 'unavailable' });
    expect(await t(401).append('chat', { id: 'a', body: 'x' })).toEqual({ kind: 'unauthenticated' });
    await expect(t(503).markRead('chat', { seq: 1 as Seq, mentionSeq: 0 as Seq })).rejects.toThrow('503');
  });

  it('maps a page: records, removed ids, the highest seq, more and the read marks', async () => {
    const wire = {
      messages: [msg(3), msg(4, { removed: true, author: null, body: null }), msg(5)],
      head: 9,
      read: { last_read_seq: 2, last_mention_seq: 1 },
      members: [{ id: 'anna', name: 'Anna' }],
    };
    const r = await t(200, wire).page('chat', 2 as Seq, 3);
    expect(r.kind === 'ok' && r.value).toMatchObject({
      removed: ['m4'],
      last: 5,
      head: 9,
      more: true,
      cursor: { lastReadSeq: 2, lastMentionSeq: 1 },
      members: [{ id: 'anna', name: 'Anna' }],
    });
    expect(r.kind === 'ok' && r.value.records.map((x) => x.seq)).toEqual([3, 5]);
    const done = await t(200, { ...wire, head: 5 }).page('chat', 2 as Seq, 3);
    expect(done.kind === 'ok' && done.value.more).toBe(false);
  });

  it('an empty page has last 0 and no more', async () => {
    const r = await t(200, {
      messages: [],
      head: 0,
      read: { last_read_seq: 0, last_mention_seq: 0 },
      members: [],
    }).page('chat', 0 as Seq, 10);
    expect(r.kind === 'ok' && [r.value.last, r.value.more]).toEqual([0, false]);
  });

  it('an empty page has no more even when the head is ahead of the cursor', async () => {
    const r = await t(200, {
      messages: [],
      head: 7,
      read: { last_read_seq: 0, last_mention_seq: 0 },
      members: [],
    }).page('chat', 7 as Seq, 10);
    expect(r.kind === 'ok' && r.value.more).toBe(false);
  });

  it('throws on a live message without author or body, so the next pull retries the page', async () => {
    const read = { last_read_seq: 0, last_mention_seq: 0 };
    await expect(
      t(200, { messages: [msg(1, { author: null })], head: 1, read }).page('chat', 0 as Seq, 10),
    ).rejects.toThrow('no author or body');
    await expect(
      t(201, { message: msg(1, { body: null }) }).append('chat', { id: 'a', body: 'x' }),
    ).rejects.toThrow('no author or body');
  });

  it('reads a refusal from a 400 or 409 and the stored message from 200 or 201', async () => {
    const e = { error: { code: 'invalid_body', message: 'must be at most 4000 characters' } };
    expect(await t(400, e).append('chat', { id: 'a', body: 'x' })).toEqual({
      kind: 'ok',
      value: { outcome: 'refused', code: 'invalid_body', reason: 'must be at most 4000 characters' },
    });
    expect(
      await t(409, { error: { code: 'conflict', message: 'taken' } }).append('chat', { id: 'a', body: 'x' }),
    ).toMatchObject({ value: { outcome: 'refused', code: 'conflict' } });
    for (const status of [200, 201]) {
      const ok = await t(status, { message: msg(1) }).append('chat', { id: 'm1', body: 'b1' });
      expect(ok.kind === 'ok' && ok.value.outcome === 'accepted' && ok.value.record.seq).toBe(1);
    }
  });

  it('sends the marks in the server`s snake_case and reads the answer', async () => {
    let sent = '';
    const f = (async (_u: string, init: RequestInit) => {
      sent = String(init.body);
      return new Response(JSON.stringify({ read: { last_read_seq: 5, last_mention_seq: 3 } }));
    }) as unknown as typeof fetch;
    const r = await httpToolDataTransport('p', f).markRead('chat', { seq: 5 as Seq, mentionSeq: 3 as Seq });
    expect(JSON.parse(sent)).toEqual({ last_read_seq: 5, last_mention_seq: 3 });
    expect(r).toEqual({ kind: 'ok', value: { lastReadSeq: 5, lastMentionSeq: 3 } });
  });

  it('puts after and limit in the query', async () => {
    let seen = '';
    const f = (async (u: string) => {
      seen = u;
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    await httpToolDataTransport('my p', f).page('chat', 7 as Seq, 50);
    expect(seen).toBe('/api/p/my%20p/tools/chat?after=7&limit=50');
  });
});
