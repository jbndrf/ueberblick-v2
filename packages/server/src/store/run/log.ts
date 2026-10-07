/** The `run.committed` / `run.refused` events (docs/process/logging.md): one per submitted run, after the outcome is known. */
import type { Run } from '@ueberblick/core';
import type { Logger } from '../../log';
import type { BatchResult } from './contract';

/** The runs a batch call wrote a ledger row for (replays are not logged again). Filled by `execute`. */
export interface Fresh {
  runs: readonly Run[];
}

/** Logs every fresh run of a batch: committed with its observation count, or refused with its refusal code. */
export function logBatch(log: Logger, fresh: Fresh, result: BatchResult, ms: number): void {
  for (const run of fresh.runs) {
    if (result.outcome === 'accepted') {
      const own = result.results.find((r) => r.runId === run.id);
      log.log('run.committed', {
        runId: run.id,
        actor: run.actor.id,
        observations: own?.observations.length ?? 0,
        ms,
      });
    } else {
      log.log('run.refused', {
        runId: run.id,
        actor: run.actor.id,
        code: run.id === result.runId ? result.refusal.code : 'batch_failed',
        ms,
      });
    }
  }
}
