/**
 * The value-move executor (WP-307): walks the open `deploy_moves` rows, one `$move` system run per affected feature
 * (R3, the same `store.submit` every run takes; a `recompute` row runs `$recompute` instead, WP-312), in batches of at most `batchSize` features. A batch and the row's
 * `next_id` commit together, so a kill between batches loses nothing and a restart moves no feature twice. Between
 * batches it yields (`pause`), so requests are served while 20k features move. Feature selection is
 * `featuresToMove`, which skips pinned features (A-029).
 */
import {
  MOVE_TASK,
  RECOMPUTE_TASK,
  type FeatureId,
  type Ids,
  type Json,
  type Key,
  type Run,
} from '@ueberblick/core';
import type { Db } from '../db/driver';
import type { Store } from '../store';
import { SYSTEM_ACTOR } from '../timers/fire';
import { featuresToMove, type MovePayload } from './move-select';

/** Features per transaction; the work package's cap. */
export const MOVE_BATCH_SIZE = 500;

export interface MoveExecutorDeps {
  /** The project's store: moves are submitted through it like every run. */
  readonly store: Pick<Store, 'submit'>;
  readonly ids: Pick<Ids, 'runId'>;
  /** Yields to the event loop between batches (`setImmediate` in the runtime). */
  readonly pause: () => Promise<void>;
  readonly batchSize?: number;
  /** Test hook: called after each committed batch of this pass with its number (1-based). A throw is a "kill". */
  readonly afterBatch?: (batch: number) => void;
}

export interface MoveRunResult {
  /** Runs accepted in this pass. */
  readonly moved: number;
  /** Runs the plan refused (the feature or property no longer fits the version); their features stay as they are. */
  readonly refused: number;
}

export interface MoveExecutor {
  /** Processes every open row to the end; one pass at a time per executor (a second call joins the first). */
  run(): Promise<MoveRunResult>;
  /** Fire and forget `run()`; a failure goes to `onError` and the rows stay open for the next start. */
  start(onError: (e: unknown) => void): void;
  /** Open rows remain. */
  pending(): boolean;
}

interface Row {
  id: number;
  version: number;
  payload: string;
  next_id: string;
}

export const inputOf = (m: MovePayload): { readonly [field: string]: Json } =>
  'recompute' in m
    ? {}
    : 'to_property' in m
      ? { property: m.property, to_property: m.to_property }
      : { property: m.property, from: m.from, to: m.to };

export function createMoveExecutor(db: Db, deps: MoveExecutorDeps): MoveExecutor {
  const batchSize = deps.batchSize ?? MOVE_BATCH_SIZE;
  const open = db.prepare<Row>(
    'SELECT id, version, payload, next_id FROM deploy_moves WHERE done = 0 ORDER BY id LIMIT 1',
  );
  const advance = db.prepare('UPDATE deploy_moves SET next_id = ? WHERE id = ?');
  const finish = db.prepare('UPDATE deploy_moves SET done = 1 WHERE id = ?');
  let running: Promise<MoveRunResult> | undefined;

  async function pass(): Promise<MoveRunResult> {
    let moved = 0;
    let refused = 0;
    let batches = 0;
    for (let row = open.get(); row !== undefined; row = open.get()) {
      const move = JSON.parse(row.payload) as MovePayload;
      const ids = featuresToMove(db, move, row.next_id, batchSize);
      if (ids.length === 0) {
        finish.run(row.id);
        continue;
      }
      const { id, version } = row;
      db.transaction(() => {
        for (const featureId of ids) {
          const run: Run = {
            id: deps.ids.runId(),
            task: ('recompute' in move ? RECOMPUTE_TASK : MOVE_TASK) as Key,
            actor: SYSTEM_ACTOR,
            configVersion: version,
            featureId: featureId as FeatureId,
            input: inputOf(move),
          };
          if (deps.store.submit(run).outcome === 'accepted') moved++;
          else refused++;
        }
        advance.run(ids[ids.length - 1] as string, id);
      });
      deps.afterBatch?.(++batches);
      await deps.pause();
    }
    return { moved, refused };
  }

  return {
    run() {
      running ??= pass().finally(() => {
        running = undefined;
      });
      return running;
    },
    start(onError) {
      this.run().catch(onError);
    },
    pending: () => open.get() !== undefined,
  };
}
