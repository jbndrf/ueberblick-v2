/**
 * Which features a queue change touches (WP-800, R14). The run queue lays one prediction per queued run over the
 * synced state (`DeviceStore.putPrediction`, `dropPrediction`), and the features of that prediction are exactly the
 * ones whose current state changes. This wraps the store the queue is given and names those ids, so the views redraw
 * the touched features instead of walking every feature of the view per queue change (a submit, each drained entry).
 * The queue contract is unchanged: it sees the same store.
 */
import type { DeviceStore, Prediction } from '@ueberblick/client';
import type { FeatureId, RunId } from '@ueberblick/core/model';
import { ALL } from './changed';

export type TouchedSink = (touched: typeof ALL | readonly FeatureId[]) => void;

export function touchedByPredictions(store: DeviceStore, touched: TouchedSink): DeviceStore {
  const known = new Map<RunId, readonly FeatureId[]>();
  return new Proxy(store, {
    get(target, prop) {
      if (prop === 'putPrediction') {
        return async (p: Prediction): Promise<void> => {
          const before = known.get(p.runId) ?? [];
          await target.putPrediction(p);
          const now = p.features.map((f) => f.id);
          known.set(p.runId, now);
          touched([...before, ...now]);
        };
      }
      if (prop === 'dropPrediction') {
        return async (runId: RunId): Promise<void> => {
          const before = known.get(runId);
          await target.dropPrediction(runId);
          known.delete(runId);
          // a prediction of an earlier session: its features are not known here
          touched(before ?? ALL);
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}
