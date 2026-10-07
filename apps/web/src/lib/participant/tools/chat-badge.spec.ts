import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Instant, Seq } from '@ueberblick/core/model';
import type { ToolDataCursor, ToolDataItem } from '@ueberblick/ui/tool-api';
import { chatBadge } from './chat-badge';

const item = (seq: number | null, author: string, mentions: string[] = []): ToolDataItem => ({
  id: `m${seq ?? 'p'}${author}`,
  seq: seq as Seq | null,
  author,
  at: '2026-10-02T08:00:00.000Z' as Instant,
  body: 'x',
  mentions: { persons: mentions, features: [] },
});
const cursor = (read: number, mention = 0): ToolDataCursor => ({
  lastReadSeq: read as Seq,
  lastMentionSeq: mention as Seq,
});

describe('chatBadge (v3 unread-store.svelte.ts:324-343, by seq not clock)', () => {
  it('counts messages of others after the read mark; the mention count is those that mention me', () => {
    const items = [
      item(1, 'a'),
      item(2, 'a', ['me']),
      item(3, 'me'),
      item(4, 'b', ['me', 'x']),
      item(5, 'b'),
    ];
    expect(chatBadge(items, cursor(1), 'me')).toEqual({ hard: 2, soft: true });
    expect(chatBadge(items, cursor(4), 'me')).toEqual({ hard: 0, soft: true });
    expect(chatBadge(items, cursor(5), 'me')).toEqual({ hard: 0, soft: false });
  });

  it('with nothing read, every message of others is unread (v3: no row means the epoch)', () => {
    expect(chatBadge([item(1, 'a'), item(2, 'me')], cursor(0), 'me')).toEqual({ hard: 0, soft: true });
  });

  it('own messages and sends that wait (no seq) never count', () => {
    expect(chatBadge([item(1, 'me'), item(null, 'me', ['me'])], cursor(0), 'me')).toEqual({
      hard: 0,
      soft: false,
    });
  });

  it('a mention counts only above the mention mark, and reading clears both', () => {
    const items = [item(1, 'a', ['me']), item(2, 'a', ['me']), item(3, 'a')];
    expect(chatBadge(items, cursor(0, 1), 'me')).toEqual({ hard: 1, soft: true });
    expect(chatBadge(items, cursor(3, 0), 'me')).toEqual({ hard: 0, soft: false });
  });

  it('is empty for an empty chat', () => {
    expect(chatBadge([], cursor(0), 'me')).toEqual({ hard: 0, soft: false });
  });

  it('property: equals the plain filter over the whole list', () => {
    const rows = fc.array(
      fc.record({
        author: fc.constantFrom('me', 'a', 'b'),
        mention: fc.boolean(),
        pending: fc.boolean(),
      }),
      { maxLength: 60 },
    );
    fc.assert(
      fc.property(rows, fc.nat(60), fc.nat(60), (list, read, mentionMark) => {
        let seq = 0;
        const items = list.map((r) => item(r.pending ? null : ++seq, r.author, r.mention ? ['me'] : []));
        const got = chatBadge(items, cursor(read, mentionMark), 'me');
        const theirs = items.filter((i) => i.seq !== null && i.seq > read && i.author !== 'me');
        expect(got.soft).toBe(theirs.length > 0);
        expect(got.hard).toBe(
          theirs.filter((i) => (i.seq as number) > mentionMark && i.mentions.persons.includes('me')).length,
        );
      }),
    );
  });
});
