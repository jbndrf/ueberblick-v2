/**
 * Budget (docs/12): a 60k snapshot in <= 20 s and <= 100 ms main-thread per page decode.
 * A 1,000-feature page (with 3 observations each, JSON text round trip included) must decode well
 * under 100 ms. Seeded, deterministic data; nothing is committed.
 */
import { describe, it } from 'vitest';
import { assertBudget, defineBudget, docBudget, report } from '../harness/budget.mjs';
import type { FeatureId, Key, RunId } from '../../packages/core/src/model';
import { decodePage, encodePage, type SyncPage } from '../../packages/core/src/sync';

function makePage(n: number): SyncPage {
  const features = [];
  const observations = [];
  for (let i = 0; i < n; i++) {
    const id = `018f0000-0000-7000-8000-${String(i).padStart(12, '0')}` as FeatureId;
    const geometry = { type: 'Point', coordinates: [13 + i / 1e5, 52 + i / 1e5, 30 + (i % 10)] };
    features.push({
      id,
      type: 'tree' as Key,
      properties: { geometry, species: `species-${i % 40}`, height_m: (i % 300) / 10, health: 'good' },
      lifecycle: 'active' as const,
      version: 1,
      updatedSeq: i + 1,
    });
    for (let k = 0; k < 3; k++)
      observations.push({
        featureId: id,
        property: 'height_m',
        result: (i % 300) / 10 + k,
        phenomenonTime: null,
        resultTime: null,
        seq: i * 3 + k + 1,
        runId: `018f0000-0000-7000-9000-${String(i * 3 + k).padStart(12, '0')}` as RunId,
      });
  }
  return {
    header: {
      kind: 'snapshot',
      cursor: n,
      head: n,
      more: true,
      scopeFingerprint: '0123456789abcdef0123456789abcdef',
      versions: { deployed: 1, live: [1] },
    },
    features,
    edges: [],
    observations,
    tombstones: [],
    // WP-601: one run row per run on the page, with the actors' names
    runs: observations.map((o, i) => ({
      id: o.runId,
      task: 'inspect',
      actor: `participant-${i % 20}`,
      clientTime: 1_780_000_000_000 + i,
      receivedAt: 1_780_000_000_500 + i,
      seq: o.seq,
      causedBy: null,
    })),
    people: Array.from({ length: 20 }, (_, i) => ({
      id: `participant-${i}`,
      name: `Participant Number ${i}`,
    })),
  };
}

const page = makePage(1000);
const text = JSON.stringify(encodePage(page));

/** Median of `runs` timed calls, in ms, after a warm-up. */
function median(fn: () => void, runs = 30): number {
  for (let i = 0; i < 5; i++) fn();
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    fn();
    t.push(performance.now() - s);
  }
  return t.sort((a, b) => a - b)[Math.floor(runs / 2)] ?? 0;
}

describe('sync codec, 1000-feature page (3 observations each)', () => {
  it('meets the decode budget', () => {
    const enc = median(() => encodePage(page));
    const dec = median(() => decodePage(JSON.parse(text)));
    const parse = median(() => JSON.parse(text));
    const pages60k = 60;
    console.log(
      `encode ${enc.toFixed(2)} ms | JSON.parse ${parse.toFixed(2)} ms | JSON.parse+decode ${dec.toFixed(2)} ms | ` +
        `60k snapshot codec estimate ${((dec + enc) * pages60k).toFixed(0)} ms | page bytes ${text.length}`,
    );
    assertBudget(report(docBudget('long-task', { device: 'x4', thread: 'worker' }), Number(dec.toFixed(2))));
    assertBudget(
      report(
        defineBudget({
          id: 'sync-codec-snapshot-60k',
          limit: 20_000,
          unit: 'ms',
          derivedFrom:
            'snapshot-60k: encode plus decode share of the snapshot (client decode counts on the device)',
          device: 'x4',
          thread: 'worker',
        }),
        Math.round((dec + enc) * pages60k),
      ),
    );
  });
});
