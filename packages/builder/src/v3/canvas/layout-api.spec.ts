import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayoutSaver,
  pruned,
  SAVE_DELAY_MS,
  withStored,
  type CanvasLayoutApi,
  type PlacedNode,
} from './layout-api';

const at = (x: number, y: number) => ({ x, y });

describe('withStored', () => {
  it('stored positions win; nodes without one keep the automatic arrangement', () => {
    const arranged = new Map([
      ['stage:a', at(0, 0)],
      ['stage:b', at(330, 0)],
      ['global', at(-300, 0)],
    ]);
    const out = withStored(arranged, new Map([['stage:a', at(5, 6)]]));
    expect(out.get('stage:a')).toEqual(at(5, 6));
    expect(out.get('stage:b')).toEqual(at(330, 0));
    expect(out.get('global')).toEqual(at(-300, 0));
  });

  it('ignores a stored position of a node that no longer exists', () => {
    const out = withStored(new Map([['stage:a', at(0, 0)]]), new Map([['stage:gone', at(9, 9)]]));
    expect([...out.keys()]).toEqual(['stage:a']);
  });

  it('property: the result has exactly the arranged ids, and a stored id takes its stored point', () => {
    const ids = fc.uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 8 });
    fc.assert(
      fc.property(ids, ids, (a, s) => {
        const arranged = new Map(a.map((id, i) => [id, at(i, i)] as const));
        const stored = new Map(s.map((id, i) => [id, at(-i - 1, 100)] as const));
        const out = withStored(arranged, stored);
        expect([...out.keys()].sort()).toEqual([...a].sort());
        for (const [id, p] of out) expect(p).toEqual(stored.has(id) ? stored.get(id) : arranged.get(id));
      }),
    );
  });
});

describe('pruned', () => {
  it('drops the positions of nodes that no longer exist', () => {
    const stored = new Map([
      ['stage:a', at(1, 2)],
      ['stage:gone', at(3, 4)],
    ]);
    expect(pruned(stored, new Set(['stage:a', 'global']))).toEqual([{ id: 'stage:a', x: 1, y: 2 }]);
  });
});

describe('createLayoutSaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const fake = () => {
    const saved: (readonly PlacedNode[])[] = [];
    const api: CanvasLayoutApi = {
      load: async () => [],
      save: async (_type, nodes) => void saved.push(nodes),
    };
    return { api, saved };
  };

  it('sends one request for drags that follow each other, with the last positions', async () => {
    const { api, saved } = fake();
    const saver = createLayoutSaver(api, 'baum');
    saver.schedule([{ id: 'a', x: 1, y: 1 }]);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1);
    saver.schedule([{ id: 'a', x: 2, y: 2 }]);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(saved).toEqual([[{ id: 'a', x: 2, y: 2 }]]);
  });

  it('flush sends a pending save at once and only once', async () => {
    const { api, saved } = fake();
    const saver = createLayoutSaver(api, 'baum');
    saver.schedule([{ id: 'a', x: 1, y: 1 }]);
    await saver.flush();
    await saver.flush();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(saved).toHaveLength(1);
  });

  it('a failed save does not throw', async () => {
    const saver = createLayoutSaver(
      {
        load: async () => [],
        save: async () => {
          throw new Error('offline');
        },
      },
      'baum',
    );
    saver.schedule([]);
    await expect(saver.flush()).resolves.toBeUndefined();
  });
});
