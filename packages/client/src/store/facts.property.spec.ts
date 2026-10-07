/** Facts over IndexedDB equal a naive in-memory model on generated page sequences (also after reopen). */
import { edgeKey } from '@ueberblick/core/fold';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Edge, FeatureId, FeatureState, RecordedObservation } from '@ueberblick/core/model';
import type { SyncEdge, SyncTombstone } from '@ueberblick/core/sync';
import type { PageRows } from './contract';
import { openDeviceStore } from './open';
import { cursorAt, fakeEnv, feature, fid, key, memoryMarker, obs, plainEdge, rows } from './test-env';

const HISTORY = 10;

/** The reference: the semantics of docs/07 written the obvious way. */
class Model {
  features = new Map<FeatureId, FeatureState>();
  edges = new Map<string, SyncEdge>();
  history = new Map<string, RecordedObservation[]>();

  apply(p: PageRows): void {
    for (const f of p.features) {
      const cur = this.features.get(f.id);
      if (!cur || f.updatedSeq >= cur.updatedSeq) this.features.set(f.id, f);
    }
    for (const e of p.edges) {
      const cur = this.edges.get(edgeKey(e));
      if (!cur || e.updatedSeq >= cur.updatedSeq) this.edges.set(edgeKey(e), e);
    }
    for (const o of p.observations) {
      const k = `${o.featureId}|${o.property}`;
      const list = (this.history.get(k) ?? []).filter((x) => x.seq !== o.seq);
      list.push({
        featureId: o.featureId,
        property: o.property,
        result: o.result,
        seq: o.seq,
        runId: o.runId,
        ...(o.phenomenonTime === null ? {} : { phenomenonTime: o.phenomenonTime }),
      });
      list.sort((a, b) => b.seq - a.seq);
      this.history.set(k, list.slice(0, HISTORY));
    }
    for (const t of p.tombstones) this.tombstone(t);
  }

  private tombstone(t: SyncTombstone): void {
    if (t.kind === 'edge') {
      const e = this.edges.get(t.id);
      if (e && e.updatedSeq <= t.seq) this.edges.delete(t.id);
      return;
    }
    const f = this.features.get(t.id as FeatureId);
    if (!f || f.updatedSeq > t.seq) return;
    this.features.delete(f.id);
    for (const [k, v] of [...this.history]) if (v[0]?.featureId === f.id) this.history.delete(k);
    for (const [k, e] of [...this.edges])
      if ((e.from === f.id || e.to === f.id) && e.updatedSeq <= t.seq) this.edges.delete(k);
  }

  edgesFrom(id: FeatureId, rel?: string): Edge[] {
    return [...this.edges.values()]
      .filter((e) => e.from === id && (!rel || e.relation === rel))
      .map(plainEdge);
  }
  edgesTo(id: FeatureId, rel?: string): Edge[] {
    return [...this.edges.values()].filter((e) => e.to === id && (!rel || e.relation === rel)).map(plainEdge);
  }
}

const N = 5;
const pageArb = fc.record({
  features: fc.array(
    fc.record({
      n: fc.integer({ min: 1, max: N }),
      seq: fc.integer({ min: 1, max: 40 }),
      v: fc.integer({ min: 0, max: 9 }),
    }),
    { maxLength: 4 },
  ),
  edges: fc.array(
    fc.record({
      a: fc.integer({ min: 1, max: N }),
      b: fc.integer({ min: 1, max: N }),
      rel: fc.constantFrom('parent', 'near'),
      seq: fc.integer({ min: 1, max: 40 }),
    }),
    { maxLength: 4 },
  ),
  observations: fc.array(
    fc.record({
      n: fc.integer({ min: 1, max: N }),
      prop: fc.constantFrom('h', 'w'),
      seq: fc.integer({ min: 1, max: 60 }),
    }),
    { maxLength: 14 },
  ),
  tombstones: fc.array(
    fc.record({ n: fc.integer({ min: 1, max: N }), seq: fc.integer({ min: 1, max: 40 }) }),
    { maxLength: 1 },
  ),
});

describe('Facts over IndexedDB match the in-memory model', () => {
  it('holds for generated page sequences, live and after reopen', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(pageArb, { minLength: 1, maxLength: 5 }), async (pages) => {
        const env = fakeEnv();
        const marker = memoryMarker();
        const store = await openDeviceStore('prop', { env, marker });
        const model = new Model();
        let cursor = 0;
        for (const p of pages) {
          const r = rows({
            features: p.features.map((f) => feature(f.n, f.seq, { v: f.v })),
            edges: p.edges.map((e) => ({
              from: fid(e.a),
              relation: key(e.rel),
              to: fid(e.b),
              derived: false,
              updatedSeq: e.seq,
            })),
            observations: p.observations.map((o) => obs(o.n, o.prop, o.seq)),
            tombstones: p.tombstones.map((t) => ({ seq: t.seq, kind: 'feature' as const, id: fid(t.n) })),
          });
          model.apply(r);
          await store.applyPage(r, cursorAt(++cursor, 'delta'));
        }
        const ids = Array.from({ length: N }, (_, i) => fid(i + 1));
        const check = async (s: typeof store) => {
          await s.warmHistory(ids);
          for (const id of ids) {
            expect(s.facts.feature(id)).toEqual(model.features.get(id));
            expect(sorted(s.facts.edgesFrom(id))).toEqual(sorted(model.edgesFrom(id)));
            expect(sorted(s.facts.edgesTo(id, key('near')))).toEqual(sorted(model.edgesTo(id, 'near')));
            for (const prop of ['h', 'w'])
              expect(s.facts.history(id, prop, 100)).toEqual(model.history.get(`${id}|${prop}`) ?? []);
          }
        };
        await check(store);
        store.close();
        await check(await openDeviceStore('prop', { env, marker }));
      }),
      { numRuns: 40 },
    );
  });
});

const sorted = (es: readonly Edge[]) => [...es].sort((x, y) => edgeKeyOf(x).localeCompare(edgeKeyOf(y)));
const edgeKeyOf = (e: Edge) => `${e.from}|${e.relation}|${e.to}`;
