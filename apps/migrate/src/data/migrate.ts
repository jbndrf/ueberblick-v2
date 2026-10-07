/**
 * Submits the batches of `convertData` to a store and keeps the id map. A batch is atomic (`submitBatch`). When the
 * store refuses one, its runs are submitted one by one under derived ids (a refused batch leaves its own ids
 * rejected), so one bad record costs one run and is reported, not the batch.
 */
import type { FeatureId, Run } from '@ueberblick/core';
import type { Db, Store, SubmitResult } from '@ueberblick/server';
import { convertData, type ConvertDataOptions } from './convert';
import { createIdMap, singleRunId } from './ids';
import type { Mapping } from '../config/convert';
import { fillRoster } from './roster';
import type { Checkpoint, DataProblem, IdMap, RunBatch, V3DataExport } from './types';

export interface MigrationResult {
  /** Batches submitted in this call. */
  readonly batches: number;
  /** Runs the store accepted. */
  readonly accepted: number;
  readonly problems: readonly DataProblem[];
  /** True when `stop` ended the call before the last batch. */
  readonly stopped: boolean;
  /** The next batch to submit; store it (with `checkpoint(next, ids)`) to continue later. */
  readonly next: number;
}

export interface MigrateOptions {
  /** Called after each submitted batch with the next batch index; return `false` to stop here. */
  readonly after?: (batch: RunBatch, next: number) => boolean | undefined;
}

const createdId = (r: Extract<SubmitResult, { outcome: 'accepted' }>): FeatureId | undefined =>
  r.observations.find((o) => o.property === '$type')?.featureId;

export async function migrate(
  store: Store,
  batches: AsyncIterable<RunBatch>,
  ids: IdMap,
  options: MigrateOptions = {},
): Promise<MigrationResult> {
  const problems: DataProblem[] = [];
  let count = 0;
  let accepted = 0;
  let next = 0;
  let stopped = false;
  for await (const batch of batches) {
    problems.push(...batch.problems);
    const learn = (i: number, r: Extract<SubmitResult, { outcome: 'accepted' }>): void => {
      accepted++;
      const id = batch.creates ? createdId(r) : undefined;
      if (id !== undefined) ids.set(batch.sources[i] as string, id);
    };
    if (batch.runs.length > 0) {
      const r = store.submitBatch(batch.runs);
      if (r.outcome === 'accepted') r.results.forEach((x, i) => learn(i, x));
      else {
        batch.runs.forEach((run: Run, i) => {
          const one = store.submit({ ...run, id: singleRunId(run.id) });
          if (one.outcome === 'accepted') learn(i, one);
          else
            problems.push({
              code: 'refused',
              record: batch.sources[i] as string,
              message: `${one.refusal.code}: ${one.refusal.message}`,
            });
        });
      }
    }
    count++;
    next = batch.index + 1;
    if (options.after?.(batch, next) === false) {
      stopped = true;
      break;
    }
  }
  return { batches: count, accepted, problems, stopped, next };
}

/** `convertData` and `migrate` in one call: the whole conversion into `store`, after the roster when `options.roster` is given. */
export async function runMigration(
  store: Store,
  v3: V3DataExport,
  mapping: Mapping,
  options: ConvertDataOptions &
    MigrateOptions & {
      readonly resume?: Checkpoint;
      /** The project database of `store`: when given, the v3 users fill its roster first (`fillRoster`). */
      readonly roster?: Db;
    },
): Promise<MigrationResult & { readonly ids: IdMap }> {
  const roster = options.roster ? fillRoster(options.roster, v3.users, mapping) : undefined;
  const ids = options.ids ?? createIdMap(options.resume?.ids);
  const batches = convertData(v3, mapping, { ...options, ids });
  const result = await migrate(store, batches, ids, options.after ? { after: options.after } : {});
  return { ...result, problems: [...(roster?.problems ?? []), ...result.problems], ids };
}
