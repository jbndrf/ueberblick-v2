/**
 * Budget (docs/12, WP-511): enqueue including plan, fold, store and prediction <= 50 ms p95 on the 60k corpus.
 * fake-indexeddb runs its transactions in JS on the same thread, so the wall time is an upper bound.
 * Run: npm run bench (see bench/README.md for one folder)
 */
import { describe, expect, it } from 'vitest';
import { createClock, createIds } from '@ueberblick/core/testing';
import type { FeatureId, Key, RunId } from '../../packages/core/src/model';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { openDeviceStore } from '../../packages/client/src/store/open';
import { fakeEnv, memoryMarker } from '../../packages/client/src/store/test-env';
import { createRunQueue } from '../../packages/client/src/queue/queue';
import { noLock } from '../../packages/client/src/queue/lock';
import { FakeRunServer, NOW, anna, fakeTimers, seed } from '../../packages/client/src/queue/queue.testing';
import { musterstadt } from '../../packages/client/src/queue/world.testing';

const TREES = 60_000;
const RUNS = 300;
const id = (n: number) => `018f0000-0000-7000-8000-${String(n + 100).padStart(12, '0')}` as FeatureId;

describe('client queue', () => {
  it('enqueue with prediction on a 60k-feature store: p95 <= 50 ms', async () => {
    const { config, world } = musterstadt();
    const store = await openDeviceStore('bench', { env: fakeEnv(), marker: memoryMarker() });
    await seed(store, world);
    for (let p = 0; p < TREES / 1000; p++) {
      const features = Array.from({ length: 1000 }, (_, i) => {
        const n = p * 1000 + i;
        return {
          id: id(n),
          type: 'baum' as Key,
          properties: {
            geometrie: { type: 'Point' as const, coordinates: [7.2 + n / 1e5, 50.8, 0] },
            stage: 'erfasst',
            vitalitaet: 'v2',
            befund: `b${n}`,
          },
          lifecycle: 'active' as const,
          updatedSeq: n + 10,
        };
      });
      await store.applyPage(
        { features, edges: [], observations: [], tombstones: [], runs: [], people: [] },
        { kind: 'delta', cursor: (p + 1) * 1000 + 10, scopeFingerprint: 's' },
      );
    }
    const queue = await createRunQueue({
      store,
      config: { get: () => config },
      transport: new FakeRunServer(),
      blobTransport: { has: async () => true, put: async () => 'ok' },
      lock: noLock,
      clock: createClock(NOW),
      ids: createIds(9),
      mono: () => performance.now(),
      timers: fakeTimers(),
      onError: (e) => {
        throw e;
      },
    });
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const run = {
        id: `018f0000-0000-7000-9000-${String(i).padStart(12, '0')}` as RunId,
        task: 'befund_ergaenzen' as Key,
        actor: anna,
        configVersion: 1,
        featureId: id((i * 197) % TREES),
        input: { befund: `neu ${i}` },
      };
      const t = performance.now();
      const r = await queue.enqueue(run);
      times.push(performance.now() - t);
      expect(r.ok).toBe(true);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)] as number;
    console.log(
      `client-queue: enqueue p95 ${p95.toFixed(1)} ms, median ${(times[RUNS >> 1] as number).toFixed(1)} ms, over ${RUNS} runs on ${TREES} features (fake IDB)`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'client-queue-enqueue-p95',
          limit: 50,
          unit: 'ms',
          derivedFrom: 'WP-511: enqueue including prediction; interaction-to-next-paint 200 ms row',
          device: 'x4',
          thread: 'worker',
        }),
        Number(p95.toFixed(1)),
      ),
    );
  });
});
