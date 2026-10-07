import { describe, expect, it } from 'vitest';
import type { Seq } from '@ueberblick/core/model';
import { kit, FakeToolServer } from './tooldata.testing';

describe('mirror', () => {
  it('pages the stream from the stored cursor until `more` is false', async () => {
    const k = await kit({ pageLimit: 2 });
    for (let i = 1; i <= 5; i++) k.server.post('chat', 'anna', `m${i}`);
    await k.data.pull('chat');
    expect(k.store.records('chat')).toHaveLength(5);
    expect(k.server.calls).toEqual(['page:chat:0', 'page:chat:2', 'page:chat:4']);
    k.server.calls.length = 0;
    k.server.post('chat', 'anna', 'm6');
    await k.data.pull('chat');
    expect(k.server.calls).toEqual(['page:chat:5']);
    expect(k.store.cursor('chat')).toBe(6);
  });

  it('resumes after a reload from the stored cursor', async () => {
    const k = await kit();
    k.server.post('chat', 'anna', 'a');
    await k.data.pull('chat');
    const again = await k.reopen();
    again.server.calls.length = 0;
    await again.data.pull('chat');
    expect(again.server.calls).toEqual(['page:chat:1']);
    expect(again.data.handle('chat').items()).toHaveLength(1);
  });

  it('pulls only the tools available to the person, on start too', async () => {
    const server = new FakeToolServer(['chat', 'secret']);
    server.post('chat', 'anna', 'hi');
    server.post('secret', 'anna', 'no');
    const k = await kit({ server, available: () => ['chat'] });
    await k.data.pullAll();
    expect(server.calls).toEqual(['page:chat:0']);
    expect(await k.data.pull('secret')).toBe(0);
    expect(server.calls).toEqual(['page:chat:0']);
  });

  it('an unavailable answer (404) mirrors nothing and does not throw', async () => {
    const server = new FakeToolServer([]);
    const k = await kit({ server });
    await expect(k.data.pull('chat')).resolves.toBe(0);
    expect(k.store.records('chat')).toEqual([]);
  });

  it('a transient failure rejects and keeps what was mirrored', async () => {
    const k = await kit({ pageLimit: 1 });
    k.server.post('chat', 'a', '1');
    k.server.post('chat', 'a', '2');
    await k.data.pull('chat');
    k.server.post('chat', 'a', '3');
    k.server.offline = true;
    await expect(k.data.pull('chat')).rejects.toThrow('offline');
    expect(k.store.records('chat')).toHaveLength(2);
  });

  it('a pull in flight is shared (single flight per tool)', async () => {
    const k = await kit();
    k.server.post('chat', 'a', '1');
    await Promise.all([k.data.pull('chat'), k.data.pull('chat')]);
    expect(k.server.calls.filter((c) => c.startsWith('page'))).toHaveLength(1);
  });
});

describe('erasure (B-005)', () => {
  it('upserts a re-delivered message by id: the older seq goes, the new text shows', async () => {
    const k = await kit();
    k.server.post('chat', 'anna', 'one', 'm1');
    k.server.post('chat', 'anna', 'secret @bob', 'm2');
    k.server.post('chat', 'anna', 'three', 'm3');
    await k.data.pull('chat');
    k.server.erase('chat', 'm2', 'secret [removed]');
    await k.data.pull('chat');
    const items = k.data.handle('chat').items();
    expect(items.map((i) => [i.id, i.body])).toEqual([
      ['m1', 'one'],
      ['m3', 'three'],
      ['m2', 'secret [removed]'], // new seq: it moves to the end of the stream
    ]);
    expect(new Set(items.map((i) => i.seq)).size).toBe(3);
    expect(k.store.cursor('chat')).toBe(4);
  });

  it('drops a removed message from the mirror and keeps the cursor moving', async () => {
    const k = await kit();
    k.server.post('chat', 'anna', 'one', 'm1');
    k.server.post('chat', 'anna', 'gone', 'm2');
    await k.data.pull('chat');
    k.server.erase('chat', 'm2');
    await k.data.pull('chat');
    expect(
      k.data
        .handle('chat')
        .items()
        .map((i) => i.id),
    ).toEqual(['m1']);
    expect(k.store.cursor('chat')).toBe(3);
    const again = await k.reopen();
    expect(
      again.data
        .handle('chat')
        .items()
        .map((i) => i.id),
    ).toEqual(['m1']);
    again.server.calls.length = 0;
    await again.data.pull('chat');
    expect(again.server.calls).toEqual(['page:chat:3']);
  });

  it('a removed message that was never mirrored changes nothing but the cursor', async () => {
    const k = await kit();
    k.server.post('chat', 'anna', 'x', 'm1');
    k.server.erase('chat', 'm1');
    await k.data.pull('chat');
    expect(k.data.handle('chat').items()).toEqual([]);
    expect(k.store.cursor('chat')).toBe(2);
  });
});

describe('outbox', () => {
  it('append returns a pending item at once, before any network call', async () => {
    const k = await kit();
    k.server.offline = true;
    const item = await k.data.handle('chat').append('hello');
    expect(item.seq).toBeNull();
    expect(item.author).toBe('me');
    expect(
      k.data
        .handle('chat')
        .items()
        .map((i) => i.body),
    ).toEqual(['hello']);
    expect(k.server.calls).toEqual([]);
  });

  it('survives a reload and sends in creation order', async () => {
    const k = await kit();
    const h = k.data.handle('chat');
    await h.append('one');
    await h.append('two');
    await h.append('three');
    const again = await k.reopen();
    expect(
      again.data
        .handle('chat')
        .items()
        .map((i) => i.body),
    ).toEqual(['one', 'two', 'three']);
    await again.data.drain();
    expect(again.server.calls).toEqual(['append:chat:one', 'append:chat:two', 'append:chat:three']);
    expect(again.server.stream('chat').map((r) => r.body)).toEqual(['one', 'two', 'three']);
    expect(again.store.outbox('chat')).toEqual([]);
  });

  it('an accepted send becomes a record and is not listed twice after a pull', async () => {
    const k = await kit();
    await k.data.handle('chat').append('hi');
    await k.data.drain();
    await k.data.pull('chat');
    const items = k.data.handle('chat').items();
    expect(items).toHaveLength(1);
    expect(items[0]?.seq).toBe(1);
  });

  it('a transient failure stops the drain and loses nothing, the next drain resumes in order', async () => {
    const k = await kit();
    const h = k.data.handle('chat');
    await h.append('one');
    await h.append('two');
    k.server.offline = true;
    const r = await k.data.drain();
    expect(r.transient).toBe(true);
    expect(k.store.outbox('chat')).toHaveLength(2);
    k.server.offline = false;
    await k.data.drain();
    expect(k.server.stream('chat').map((x) => x.body)).toEqual(['one', 'two']);
  });

  it('a server refusal marks the item refused with the reason; later items still go', async () => {
    const k = await kit();
    k.server.refuseWith = (b) => (b === 'bad' ? { code: 'body_too_long', reason: 'Too long' } : undefined);
    const h = k.data.handle('chat');
    await h.append('bad');
    await h.append('good');
    const r = await k.data.drain();
    expect(r.refused).toBe(1);
    expect(r.sent).toBe(1);
    const items = h.items();
    expect(items.map((i) => [i.body, i.refusal?.code])).toEqual([
      ['good', undefined], // accepted: part of the stream
      ['bad', 'body_too_long'], // refused: stays at the end until retried or discarded
    ]);
  });

  it('retry sends a refused item again under a new id; discard removes it', async () => {
    const k = await kit();
    let refuse = true;
    k.server.refuseWith = () => (refuse ? { code: 'x', reason: 'no' } : undefined);
    const h = k.data.handle('chat');
    const item = await h.append('bad');
    await k.data.drain();
    refuse = false;
    const again = await h.retry(item.id);
    expect(again.id).not.toBe(item.id);
    expect(h.items()).toHaveLength(1);
    await k.data.drain();
    expect(k.server.stream('chat')).toHaveLength(1);
    const second = await h.append('later');
    refuse = true;
    await k.data.drain();
    await h.discard(second.id);
    expect(h.items().map((i) => i.body)).toEqual(['bad']);
  });

  it('an unauthenticated answer pauses the drain and keeps everything', async () => {
    const k = await kit();
    await k.data.handle('chat').append('one');
    k.server.unauthenticated = true;
    const r = await k.data.drain();
    expect(r.unauthenticated).toBe(true);
    expect(k.store.outbox('chat')).toHaveLength(1);
  });

  it('a tool that is not available keeps its outbox untouched', async () => {
    const k = await kit({ available: () => [] });
    await k.data.handle('chat').append('one');
    await k.data.drain();
    expect(k.server.calls).toEqual([]);
  });

  it('appending is O(1): the cost does not grow with the outbox', async () => {
    const k = await kit();
    const h = k.data.handle('chat');
    const time = async (n: number) => {
      const t = performance.now();
      for (let i = 0; i < n; i++) await h.append('x');
      return performance.now() - t;
    };
    const first = await time(200);
    const later = await time(200);
    expect(later).toBeLessThan(first * 5 + 50);
  });
});

describe('read marks', () => {
  it('many markRead calls make one request with the highest seq', async () => {
    const k = await kit();
    const h = k.data.handle('chat');
    for (let s = 1; s <= 50; s++) h.markRead(s as Seq);
    await k.data.flushReads();
    expect(k.server.calls.filter((c) => c.startsWith('read'))).toEqual(['read:chat:50']);
    expect(h.cursor.lastReadSeq).toBe(50);
  });

  it('is sent after the delay timer, once', async () => {
    const k = await kit();
    const h = k.data.handle('chat');
    h.markRead(1 as Seq);
    h.markRead(2 as Seq);
    await new Promise((r) => setTimeout(r, 0));
    expect(k.timers.pending).toHaveLength(1);
    k.timers.fire();
    await k.data.flushReads();
    expect(k.server.calls.filter((c) => c.startsWith('read'))).toEqual(['read:chat:2']);
  });

  it('does not send what the server already knows, and survives a failed send', async () => {
    const k = await kit();
    const h = k.data.handle('chat');
    h.markRead(4 as Seq);
    k.server.offline = true;
    await expect(k.data.flushReads()).rejects.toThrow('offline');
    const again = await k.reopen();
    again.server.offline = false;
    again.server.calls.length = 0;
    await again.data.flushReads();
    expect(again.server.calls).toEqual(['read:chat:4']);
    again.server.calls.length = 0;
    again.data.handle('chat').markRead(3 as Seq);
    await again.data.flushReads();
    expect(again.server.calls).toEqual([]);
  });

  it('sends the newest mention of the person at or below the mark as the mention mark', async () => {
    const k = await kit();
    k.server.post('chat', 'anna', 'hi');
    k.server.post('chat', 'anna', 'hey @me', undefined, { persons: ['me'], features: [] });
    k.server.post('chat', 'anna', 'again', undefined);
    k.server.post('chat', 'anna', 'later @me', undefined, { persons: ['me'], features: [] });
    await k.data.pull('chat');
    k.data.handle('chat').markRead(3 as Seq);
    await k.data.flushReads();
    expect(k.server.lastMark).toEqual({ seq: 3, mentionSeq: 2 });
    k.data.handle('chat').markRead(4 as Seq);
    await k.data.flushReads();
    expect(k.server.lastMark).toEqual({ seq: 4, mentionSeq: 4 });
  });

  it('the cursor counts a pending mark at once: offline, before the server answered (max of acknowledged and pending)', async () => {
    const k = await kit();
    k.server.post('chat', 'anna', 'hi');
    k.server.post('chat', 'anna', 'hey @me', undefined, { persons: ['me'], features: [] });
    await k.data.pull('chat');
    const h = k.data.handle('chat');
    k.server.offline = true;
    h.markRead(2 as Seq);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.cursor).toEqual({ lastReadSeq: 2, lastMentionSeq: 2 });
    h.markRead(1 as Seq); // never moves back
    await new Promise((r) => setTimeout(r, 0));
    expect(h.cursor.lastReadSeq).toBe(2);
  });

  it('a pull brings the read position another device set', async () => {
    const k = await kit();
    k.server.reads.set('chat', { lastReadSeq: 7 as Seq, lastMentionSeq: 3 as Seq });
    await k.data.pull('chat');
    expect(k.data.handle('chat').cursor).toEqual({ lastReadSeq: 7, lastMentionSeq: 3 });
  });
});

describe('members', () => {
  it('the handle lists the people the last pull named, and keeps them across a reopen (works offline)', async () => {
    const k = await kit();
    expect(k.data.handle('chat').members()).toEqual([]);
    k.server.members.set('chat', [
      { id: 'anna', name: 'Anna' },
      { id: 'me', name: 'Mia' },
    ]);
    await k.data.pull('chat');
    expect(
      k.data
        .handle('chat')
        .members()
        .map((m) => m.name),
    ).toEqual(['Anna', 'Mia']);
    const again = await k.reopen();
    again.server.offline = true;
    expect(
      again.data
        .handle('chat')
        .members()
        .map((m) => m.id),
    ).toEqual(['anna', 'me']);
  });
});

describe('handle', () => {
  it('notifies subscribers on mirror and outbox changes', async () => {
    const k = await kit();
    const h = k.data.handle('chat');
    let n = 0;
    const off = h.subscribe(() => n++);
    await h.append('x');
    k.server.post('chat', 'anna', 'y');
    await k.data.pull('chat');
    expect(n).toBeGreaterThanOrEqual(2);
    off();
  });

  it('items() is stable between changes and new after one', async () => {
    const k = await kit();
    const h = k.data.handle('chat');
    const a = h.items();
    expect(h.items()).toBe(a);
    await h.append('x');
    expect(h.items()).not.toBe(a);
  });
});
