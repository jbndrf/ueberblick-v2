import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Instant, Seq } from '@ueberblick/core/model';
import type { ToolDataItem } from '@ueberblick/ui/tool-api';
import { GROUP_GAP_MS, createGrouper, groupThread, timeLabel } from './thread';

const T0 = Date.parse('2026-10-02T08:00:00.000Z');
const item = (n: number, author: string, atMs: number, seq: number | null = n): ToolDataItem => ({
  id: `m${n}`,
  seq: seq as Seq | null,
  author,
  at: new Date(atMs).toISOString() as Instant,
  body: `b${n}`,
  mentions: { persons: [], features: [] },
});

describe('groupThread (v3 MessageList.svelte:227-242)', () => {
  it('joins consecutive messages of one author under five minutes apart, measured from the previous one', () => {
    const g = groupThread(
      [
        item(1, 'a', T0),
        item(2, 'a', T0 + 4 * 60_000),
        item(3, 'a', T0 + 8 * 60_000), // 4 min after the previous one: still the group
        item(4, 'a', T0 + 8 * 60_000 + GROUP_GAP_MS), // exactly five minutes: a new group
      ],
      'me',
    );
    expect(g.map((x) => x.items.map((i) => i.id))).toEqual([['m1', 'm2', 'm3'], ['m4']]);
    expect(g[0]?.at).toBe(new Date(T0).toISOString());
  });

  it('starts a group when the author changes, and marks the reader own', () => {
    const g = groupThread([item(1, 'me', T0), item(2, 'bo', T0 + 1000), item(3, 'me', T0 + 2000)], 'me');
    expect(g.map((x) => [x.author, x.mine])).toEqual([
      ['me', true],
      ['bo', false],
      ['me', true],
    ]);
  });

  it("keeps a pending send (seq null) in the reader's own group", () => {
    const g = groupThread([item(1, 'me', T0), item(2, 'me', T0 + 1000, null)], 'me');
    expect(g).toHaveLength(1);
    expect(g[0]?.items[1]?.seq).toBeNull();
  });

  it('has no groups for no messages', () => {
    expect(groupThread([], 'me')).toEqual([]);
  });

  it('property: every message is in exactly one group, in order, and a group has one author', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom('a', 'b', 'me'), fc.integer({ min: 0, max: 20 * 60_000 })), {
          maxLength: 60,
        }),
        (rows) => {
          let t = T0;
          const items = rows.map(([author, gap], i) => item(i, author, (t += gap)));
          const groups = groupThread(items, 'me');
          expect(groups.flatMap((g) => g.items.map((i) => i.id))).toEqual(items.map((i) => i.id));
          for (const g of groups) expect(new Set(g.items.map((i) => i.author)).size).toBe(1);
        },
      ),
    );
  });
});

describe('createGrouper (incremental, R14)', () => {
  const same = (a: readonly { key: string; items: readonly ToolDataItem[] }[], b: typeof a) =>
    expect(a.map((g) => [g.key, g.items.map((i) => i.id)])).toEqual(
      b.map((g) => [g.key, g.items.map((i) => i.id)]),
    );

  it('a message at the end joins the last group or starts one, and the groups before it are the same objects', () => {
    const group = createGrouper('me');
    const a = [item(1, 'a', T0), item(2, 'b', T0 + 1000), item(3, 'b', T0 + 2000)];
    const first = group(a);
    const second = group([...a, item(4, 'b', T0 + 3000)]);
    expect(second[0]).toBe(first[0]); // untouched
    expect(second[1]?.items.map((i) => i.id)).toEqual(['m2', 'm3', 'm4']);
    const third = group([...a, item(4, 'b', T0 + 3000), item(5, 'c', T0 + 4000)]);
    expect(third).toHaveLength(3);
  });

  it('property: any sequence of appends, tail drops, replaced and inserted items gives what a fresh grouping gives', () => {
    const ops = fc.array(
      fc.oneof(
        fc.record({
          op: fc.constant('append' as const),
          author: fc.constantFrom('a', 'b', 'me'),
          gap: fc.integer({ min: 0, max: 8 * 60_000 }),
        }),
        fc.record({ op: fc.constant('drop' as const), n: fc.integer({ min: 1, max: 3 }) }),
        fc.record({ op: fc.constant('replace' as const), at: fc.nat(40) }),
        fc.record({ op: fc.constant('insert' as const), at: fc.nat(40), author: fc.constantFrom('a', 'b') }),
      ),
      { maxLength: 50 },
    );
    fc.assert(
      fc.property(ops, (sequence) => {
        const group = createGrouper('me');
        let list: ToolDataItem[] = [];
        let t = T0;
        let n = 0;
        for (const o of sequence) {
          if (o.op === 'append') list = [...list, item(++n, o.author, (t += o.gap))];
          else if (o.op === 'drop') list = list.slice(0, Math.max(0, list.length - o.n));
          else if (o.op === 'replace' && list.length > 0) {
            const i = o.at % list.length;
            list = list.map((x, k) => (k === i ? { ...x, body: 'changed' } : x));
          } else if (o.op === 'insert') {
            const i = list.length === 0 ? 0 : o.at % (list.length + 1);
            list = [...list.slice(0, i), item(++n, o.author, T0 + n * 1000), ...list.slice(i)];
          }
          same(group(list), groupThread(list, 'me'));
        }
      }),
    );
  });
});

describe('labels', () => {
  it('timeLabel follows the locale and is empty for a bad time', () => {
    expect(timeLabel('2026-10-02T08:00:00.000Z', 'en')).toContain('2026');
    expect(timeLabel('nonsense', 'de')).toBe('');
  });
});
