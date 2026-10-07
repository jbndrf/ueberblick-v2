import { describe, expect, it } from 'vitest';
import type { DeviceStore, Prediction } from '@ueberblick/client';
import type { FeatureId, FeatureState, RunId } from '@ueberblick/core/model';
import { ALL } from './changed';
import { touchedByPredictions } from './view-source-touched';

const f = (id: string) => ({ id }) as unknown as FeatureState;
const prediction = (run: string, ...ids: string[]): Prediction => ({
  runId: run as RunId,
  features: ids.map(f),
  edges: [],
  observations: [],
});

function setup() {
  const calls: string[] = [];
  const store = {
    putPrediction: async (p: Prediction) => void calls.push(`put ${p.runId}`),
    dropPrediction: async (r: RunId) => void calls.push(`drop ${r}`),
    marker: 'kept',
    hello(this: { marker: string }) {
      return this.marker;
    },
  } as unknown as DeviceStore;
  const seen: (typeof ALL | readonly FeatureId[])[] = [];
  return { calls, seen, wrapped: touchedByPredictions(store, (t) => seen.push(t)) };
}

describe('touchedByPredictions (WP-800)', () => {
  it('names the features of a stored prediction, after the store holds it', async () => {
    const { wrapped, seen, calls } = setup();
    await wrapped.putPrediction(prediction('r1', 'a', 'b'));
    expect(calls).toEqual(['put r1']);
    expect(seen).toEqual([['a', 'b']]);
  });

  it('a replaced prediction names the old and the new features; a dropped one names its last', async () => {
    const { wrapped, seen } = setup();
    await wrapped.putPrediction(prediction('r1', 'a'));
    await wrapped.putPrediction(prediction('r1', 'b'));
    expect(seen.at(-1)).toEqual(['a', 'b']);
    await wrapped.dropPrediction('r1' as RunId);
    expect(seen.at(-1)).toEqual(['b']);
  });

  it('a prediction of an earlier session is not known: everything is re-read', async () => {
    const { wrapped, seen } = setup();
    await wrapped.dropPrediction('old' as RunId);
    expect(seen).toEqual([ALL]);
  });

  it('every other call reaches the store as before', () => {
    expect((setup().wrapped as unknown as { hello(): string }).hello()).toBe('kept');
  });
});
