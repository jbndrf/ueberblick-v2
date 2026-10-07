import { describe, expect, it } from 'vitest';
import type { Instant, Seq } from '@ueberblick/core/model';
import { fakeEnv } from '../store/test-env';
import { idbBackend } from './backend-idb';
import { memoryBackend } from './backend-memory';
import { openToolDataStore } from './store';
import type { ToolDataBackend, ToolRecord } from './contract';

const at = '2026-10-02T08:00:00.000Z' as Instant;
const rec = (seq: number, id = `r${seq}`, body = `m${seq}`): ToolRecord => ({
  id,
  seq: seq as Seq,
  author: 'anna',
  at,
  body,
  mentions: { persons: [], features: [] },
});
const page = (records: ToolRecord[], more = false, removed: string[] = []) => ({
  records,
  removed,
  last: (records.at(-1)?.seq ?? 0) as Seq,
  head: (records.at(-1)?.seq ?? 0) as Seq,
  more,
  cursor: { lastReadSeq: 0 as Seq, lastMentionSeq: 0 as Seq },
  members: [],
});

const backends: [string, () => () => ToolDataBackend][] = [
  [
    'memory',
    () => {
      const b = memoryBackend();
      return () => b;
    },
  ],
  [
    'indexeddb',
    () => {
      const env = fakeEnv();
      return () => idbBackend(env, 'tooldata-test');
    },
  ],
];

describe.each(backends)('tool data store (%s)', (_name, make) => {
  it('mirrors a page with its cursor and keeps both across a reopen', async () => {
    const open = make();
    const a = await openToolDataStore(open());
    await a.applyPage('chat', page([rec(1), rec(2)]));
    expect(a.cursor('chat')).toBe(2);
    a.close();
    const b = await openToolDataStore(open());
    expect(b.records('chat').map((r) => r.seq)).toEqual([1, 2]);
    expect(b.cursor('chat')).toBe(2);
  });

  it('keeps the members of the stream with it, replaced by each page, across a reopen and apart per tool', async () => {
    const open = make();
    const a = await openToolDataStore(open());
    expect(a.members('chat')).toEqual([]);
    await a.applyPage('chat', { ...page([rec(1)]), members: [{ id: 'anna', name: 'Anna' }] });
    await a.applyPage('live', page([]));
    expect(a.members('chat')).toEqual([{ id: 'anna', name: 'Anna' }]);
    expect(a.members('live')).toEqual([]);
    await a.applyPage('chat', { ...page([]), members: [{ id: 'bo', name: 'Bo' }] });
    a.close();
    const b = await openToolDataStore(open());
    expect(b.members('chat')).toEqual([{ id: 'bo', name: 'Bo' }]);
  });

  it('applies a page twice without duplicates and keeps streams apart', async () => {
    const s = await openToolDataStore(make()());
    await s.applyPage('chat', page([rec(1), rec(2)]));
    await s.applyPage('chat', page([rec(2), rec(3)]));
    await s.applyPage('live', page([rec(1, 'x1')]));
    expect(s.records('chat').map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(s.records('live')).toHaveLength(1);
    expect(s.cursor('live')).toBe(1);
  });

  it('upserts by id: a message re-delivered under a new seq replaces its old row, also on disk', async () => {
    const open = make();
    const a = await openToolDataStore(open());
    await a.applyPage('chat', page([rec(1), rec(2, 'r2', 'secret'), rec(3)]));
    await a.applyPage('chat', page([rec(4, 'r2', 'redacted')]));
    expect(a.records('chat').map((r) => [r.seq, r.body])).toEqual([
      [1, 'm1'],
      [3, 'm3'],
      [4, 'redacted'],
    ]);
    a.close();
    const b = await openToolDataStore(open());
    expect(b.records('chat').map((r) => r.seq)).toEqual([1, 3, 4]);
    // and a second redaction still finds the row after the reload
    await b.applyPage('chat', page([rec(5, 'r2', 'again')]));
    expect(b.records('chat').map((r) => r.seq)).toEqual([1, 3, 5]);
  });

  it('a removed id is dropped, in memory and on disk, and the cursor still moves', async () => {
    const open = make();
    const a = await openToolDataStore(open());
    await a.applyPage('chat', page([rec(1), rec(2)]));
    await a.applyPage('chat', { ...page([], false, ['r2']), last: 3 as Seq, head: 3 as Seq });
    expect(a.records('chat').map((r) => r.id)).toEqual(['r1']);
    expect(a.cursor('chat')).toBe(3);
    a.close();
    const b = await openToolDataStore(open());
    expect(b.records('chat').map((r) => r.id)).toEqual(['r1']);
    expect(b.cursor('chat')).toBe(3);
  });

  it('keeps the outbox across a reopen, in creation order', async () => {
    const open = make();
    const a = await openToolDataStore(open());
    await a.enqueue('chat', { id: 'a', body: 'one', createdAt: at });
    await a.enqueue('chat', { id: 'b', body: 'two', createdAt: at });
    a.close();
    const b = await openToolDataStore(open());
    expect(b.outbox('chat').map((e) => e.id)).toEqual(['a', 'b']);
    expect(b.tools()).toContain('chat');
  });

  it('confirm moves an entry from the outbox into the mirror in one write', async () => {
    const open = make();
    const a = await openToolDataStore(open());
    await a.enqueue('chat', { id: 'a', body: 'one', createdAt: at });
    await a.confirm('chat', 'a', rec(1, 'a', 'one'));
    expect(a.outbox('chat')).toEqual([]);
    expect(a.records('chat').map((r) => r.id)).toEqual(['a']);
    a.close();
    const b = await openToolDataStore(open());
    expect(b.outbox('chat')).toEqual([]);
    expect(b.records('chat')).toHaveLength(1);
  });

  it('a page that carries an outbox entry`s record drops the entry (no duplicate)', async () => {
    const s = await openToolDataStore(make()());
    await s.enqueue('chat', { id: 'a', body: 'one', createdAt: at });
    await s.applyPage('chat', page([rec(1, 'a', 'one')]));
    expect(s.outbox('chat')).toEqual([]);
  });

  it('refuse persists the reason and remove deletes the entry', async () => {
    const open = make();
    const a = await openToolDataStore(open());
    await a.enqueue('chat', { id: 'a', body: 'x', createdAt: at });
    await a.refuse('chat', 'a', { code: 'too_long', reason: 'Too long' });
    a.close();
    const b = await openToolDataStore(open());
    expect(b.outbox('chat')[0]?.refusal).toEqual({ code: 'too_long', reason: 'Too long' });
    await b.removeOutbox('chat', 'a');
    expect(b.outbox('chat')).toEqual([]);
  });

  it('read marks are monotonic, persist and clear once the server answered', async () => {
    const open = make();
    const a = await openToolDataStore(open());
    await a.noteRead('chat', 5 as Seq);
    await a.noteRead('chat', 3 as Seq);
    expect(a.pendingRead('chat')).toBe(5);
    a.close();
    const b = await openToolDataStore(open());
    expect(b.pendingRead('chat')).toBe(5);
    await b.settleRead('chat', 5 as Seq, { lastReadSeq: 5 as Seq, lastMentionSeq: 2 as Seq });
    expect(b.pendingRead('chat')).toBeUndefined();
    expect(b.readCursor('chat')).toEqual({ lastReadSeq: 5, lastMentionSeq: 2 });
    await b.noteRead('chat', 4 as Seq); // already read
    expect(b.pendingRead('chat')).toBeUndefined();
  });

  it('a page`s read cursor never moves the stored one back', async () => {
    const s = await openToolDataStore(make()());
    await s.settleRead('chat', 9 as Seq, { lastReadSeq: 9 as Seq, lastMentionSeq: 0 as Seq });
    await s.applyPage('chat', page([rec(1)]));
    expect(s.readCursor('chat').lastReadSeq).toBe(9);
  });

  it('tells listeners the tool after a committed change', async () => {
    const s = await openToolDataStore(make()());
    const seen: string[] = [];
    s.onChange((t) => seen.push(t));
    await s.enqueue('chat', { id: 'a', body: 'x', createdAt: at });
    expect(seen).toEqual(['chat']);
  });
});
