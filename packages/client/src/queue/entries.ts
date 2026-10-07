/** Queue entries: one run, or the consecutive runs of one atomic batch (they share a `group`). */
import type { Run, RunId } from '@ueberblick/core/model';
import type { RunPayload, RunWire } from './contract';
import type { StoredRun } from '../store';

export interface Entry {
  readonly runs: readonly StoredRun[];
  readonly state: StoredRun['state'];
  readonly version: number;
}

/** Entries in device order. Runs of a group are stored in one transaction, so they are adjacent. */
export function toEntries(rows: readonly StoredRun[]): readonly Entry[] {
  const sorted = [...rows].sort((a, b) => a.order - b.order);
  const out: StoredRun[][] = [];
  for (const row of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && row.group !== undefined && last[0]?.group === row.group) last.push(row);
    else out.push([row]);
  }
  return out.map((runs) => ({
    runs,
    state: (runs[0] as StoredRun).state,
    version: (runs[0] as StoredRun).run.configVersion,
  }));
}

/** The endpoint shape: no actor and no `causedBy` (the server takes the actor from the session). */
export const toWire = (run: Run): RunWire => ({
  id: run.id,
  task: run.task,
  configVersion: run.configVersion,
  input: run.input,
  ...(run.featureId !== undefined ? { featureId: run.featureId } : {}),
  ...(run.clientTime !== undefined ? { clientTime: run.clientTime } : {}),
});

export const payloadOf = (entry: Entry): RunPayload =>
  entry.runs.length === 1
    ? { kind: 'run', run: toWire((entry.runs[0] as StoredRun).run) }
    : { kind: 'batch', runs: entry.runs.map((r) => toWire(r.run)) };

export const idsOf = (entry: Entry): readonly RunId[] => entry.runs.map((r) => r.run.id);
