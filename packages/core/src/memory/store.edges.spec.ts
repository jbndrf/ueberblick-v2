// WP-569: MemoryStore.edgesFrom/edgesTo follow the SQL relation rule: the other endpoint exists and is live.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGeo } from '../geo';
import type { FeatureId, Key, RunId } from '../model';
import { isLive } from '../registry/lifecycle';
import { goldenConfig } from '../testing/golden';
import { SIM_CONFIG_VERSION, createClock } from '../testing/ids';
import { MemoryStore } from './store';

const RUN = 'run-569' as RunId;
const id = (s: string): FeatureId => s as FeatureId;
const REL = 'baum' as Key; // massnahme.baum is a reference property to baum
const config = goldenConfig('projects/musterstadt-plain.yaml');
const fresh = (): MemoryStore =>
  new MemoryStore(config, createClock('2026-05-01T08:00:00Z'), createGeo(), SIM_CONFIG_VERSION);

const create = (s: MemoryStore, fid: string, type: string, props: Record<string, string> = {}): void => {
  s.append(RUN, [
    { featureId: id(fid), property: '$type', result: type },
    ...Object.entries(props).map(([property, result]) => ({ featureId: id(fid), property, result })),
  ]);
};
const del = (s: MemoryStore, fid: string, gone = true): void => {
  s.append(RUN, [{ featureId: id(fid), property: '$lifecycle', result: gone ? 'deleted' : 'active' }]);
};
const ends = (s: MemoryStore, from: string): string[] => s.edgesFrom(id(from), REL).map((e) => e.to);
const sources = (s: MemoryStore, to: string): string[] => s.edgesTo(id(to), REL).map((e) => e.from);

describe('MemoryStore edges keep live endpoints only', () => {
  it('skips an edge to a never-created feature, in both directions', () => {
    const s = fresh();
    create(s, 'm1', 'massnahme', { baum: 'ghost' });
    expect(s.edges.size).toBe(1); // the edge is stored ...
    expect(ends(s, 'm1')).toEqual([]); // ... but not returned
    const t = fresh();
    create(t, 'b1', 'baum');
    create(t, 'm1', 'massnahme', { baum: 'b1' });
    del(t, 'm1');
    t.features.delete(id('m1')); // a source that does not exist
    expect(sources(t, 'b1')).toEqual([]);
  });

  it('skips an edge to a deleted feature, and returns it again on undelete', () => {
    const s = fresh();
    create(s, 'b1', 'baum');
    create(s, 'm1', 'massnahme', { baum: 'b1' });
    expect(ends(s, 'm1')).toEqual(['b1']);
    del(s, 'b1');
    expect(ends(s, 'm1')).toEqual([]);
    del(s, 'b1', false);
    expect(ends(s, 'm1')).toEqual(['b1']);
  });

  it('returns an edge to a live feature, in both directions; a deleted source is skipped in edgesTo', () => {
    const s = fresh();
    create(s, 'b1', 'baum');
    create(s, 'm1', 'massnahme', { baum: 'b1' });
    expect(ends(s, 'm1')).toEqual(['b1']);
    expect(sources(s, 'b1')).toEqual(['m1']);
    del(s, 'm1');
    expect(sources(s, 'b1')).toEqual([]);
  });

  it("property: equals the SQL rule (inner join on features, lifecycle IN ('active','completed')) over random worlds", () => {
    const names = ['b1', 'b2', 'b3'];
    const op = fc.oneof(
      fc.record({ k: fc.constant('baum' as const), n: fc.constantFrom(...names) }),
      fc.record({
        k: fc.constant('del' as const),
        n: fc.constantFrom(...names, 'm1', 'm2'),
        v: fc.boolean(),
      }),
      fc.record({
        k: fc.constant('massnahme' as const),
        n: fc.constantFrom('m1', 'm2'),
        to: fc.constantFrom(...names),
      }),
    );
    fc.assert(
      fc.property(fc.array(op, { maxLength: 25 }), (ops) => {
        const s = fresh();
        const made = new Set<string>();
        for (const o of ops) {
          if (o.k === 'baum' && !made.has(o.n)) {
            made.add(o.n);
            create(s, o.n, 'baum');
          } else if (o.k === 'del' && made.has(o.n)) del(s, o.n, o.v);
          else if (o.k === 'massnahme' && !made.has(o.n)) {
            made.add(o.n);
            create(s, o.n, 'massnahme', { baum: o.to });
          }
        }
        const live = (f: string): boolean => isLive(s.features.get(id(f)));
        const all = [...s.edges.values()].filter((e) => e.relation === REL);
        for (const from of ['m1', 'm2']) {
          const expected = all.filter((e) => e.from === from && live(e.to)).map((e) => e.to);
          expect(ends(s, from).sort()).toEqual(expected.sort());
        }
        for (const to of names) {
          const expected = all.filter((e) => e.to === to && live(e.from)).map((e) => e.from);
          expect(sources(s, to).sort()).toEqual(expected.sort());
        }
      }),
      { numRuns: 100 },
    );
  });
});
