/** WP-845: `edgesFrom`/`edgesTo` of the in-memory index (fast path without a queued overlay) equal the obvious scan. */
import { edgeKey } from '@ueberblick/core/fold';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Edge, FeatureId, Key } from '@ueberblick/core/model';
import { MemoryIndex } from './memory';

const ids = ['a', 'b', 'c', 'd'].map(
  (x) => `018f0000-0000-7000-8000-00000000000${x.charCodeAt(0) - 96}` as FeatureId,
);
const relations = ['r1', 'r2'] as Key[];

const edge = fc.record({
  from: fc.constantFrom(...ids),
  relation: fc.constantFrom(...relations),
  to: fc.constantFrom(...ids),
  derived: fc.boolean(),
});
const step = fc.oneof(fc.record({ put: edge }), fc.record({ del: edge }));

describe('MemoryIndex edges', () => {
  it('equal a scan of the live edges, with and without a relation filter', () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        const mem = new MemoryIndex();
        const live = new Map<string, Edge>();
        let seq = 0;
        for (const s of steps) {
          if ('put' in s) {
            mem.putEdge(s.put, ++seq);
            live.set(edgeKey(s.put), s.put);
          } else {
            mem.deleteEdge(edgeKey(s.del));
            live.delete(edgeKey(s.del));
          }
        }
        const all = [...live.values()];
        for (const id of ids) {
          for (const relation of [undefined, ...relations]) {
            const want = (side: 'from' | 'to') =>
              all.filter((e) => e[side] === id && (relation === undefined || e.relation === relation));
            expect([...mem.edgesFrom(id, relation)].sort(cmp)).toEqual(want('from').sort(cmp));
            expect([...mem.edgesTo(id, relation)].sort(cmp)).toEqual(want('to').sort(cmp));
          }
        }
      }),
    );
  });
});

const cmp = (a: Edge, b: Edge): number => (edgeKey(a) < edgeKey(b) ? -1 : edgeKey(a) > edgeKey(b) ? 1 : 0);
