import { describe, expect, it, vi } from 'vitest';
import type { Instant, Seq } from '@ueberblick/core/model';
import type { ToolDataCursor, ToolDataItem } from '@ueberblick/ui/tool-api';
import { createToolBadges } from './badges';

interface Fake {
  items: ToolDataItem[];
  cursor: ToolDataCursor;
  set(next: ToolDataItem[], cursor?: ToolDataCursor): void;
  handle: { items(): ToolDataItem[]; readonly cursor: ToolDataCursor; subscribe(fn: () => void): () => void };
  listeners: Set<() => void>;
}
function handle(items: ToolDataItem[]): Fake {
  const listeners = new Set<() => void>();
  const h: Fake = {
    items,
    cursor: { lastReadSeq: 0 as Seq, lastMentionSeq: 0 as Seq } as ToolDataCursor,
    set(next: ToolDataItem[], cursor = h.cursor) {
      h.items = next;
      h.cursor = cursor;
      listeners.forEach((l) => l());
    },
    handle: {
      items: () => h.items,
      get cursor() {
        return h.cursor;
      },
      subscribe: (fn: () => void) => {
        listeners.add(fn);
        return () => void listeners.delete(fn);
      },
    },
    listeners,
  };
  return h;
}
const m = (seq: number, author: string, mention = false): ToolDataItem => ({
  id: `m${seq}`,
  seq: seq as Seq,
  author,
  at: '2026-10-02T08:00:00.000Z' as Instant,
  body: 'x',
  mentions: { persons: mention ? ['me'] : [], features: [] },
});

describe('createToolBadges', () => {
  it("starts with each data tool's badge, updates on a change, and tells its subscribers only when it changed", () => {
    const chat = handle([m(1, 'a', true)]);
    const badges = createToolBadges({ data: { handle: () => chat.handle }, keys: ['chat'], self: 'me' });
    expect(badges.current()).toEqual({ chat: { hard: 1, soft: true } });
    const fn = vi.fn();
    badges.subscribe(fn);
    chat.set([m(1, 'a', true), m(2, 'a')]);
    expect(fn).toHaveBeenCalledTimes(0); // the badge is the same
    chat.set(chat.items, { lastReadSeq: 2 as Seq, lastMentionSeq: 0 as Seq });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(badges.current()).toEqual({ chat: { hard: 0, soft: false } });
  });

  it('close() lets go of the streams', () => {
    const chat = handle([]);
    const badges = createToolBadges({ data: { handle: () => chat.handle }, keys: ['chat'], self: 'me' });
    expect(chat.listeners.size).toBe(1);
    badges.close();
    expect(chat.listeners.size).toBe(0);
  });

  it('a tool with no badge function adds nothing (the shell never learns tool names)', () => {
    const badges = createToolBadges({
      data: { handle: () => handle([]).handle },
      keys: ['other'],
      self: 'me',
    });
    expect(badges.current()).toEqual({});
  });
});
