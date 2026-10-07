/**
 * `convertData(v3Export, mapping, options) -> AsyncIterable<RunBatch>` (WP-301).
 *
 * The batches come in four phases (`DATA_PHASES`): table rows, creations, history, links. A batch is built only
 * when the consumer asks for it, so the consumer can submit it first: the history and link batches read the feature
 * ids that the creations got (`options.ids`, filled by `migrate`). Batches are cut by record count, so the index
 * of a batch is the same on every run of the same input, and `options.resume` can skip what is done.
 */
import type { Geo } from '@ueberblick/core';
import type { Mapping } from '../config/convert';
import {
  createRuns,
  historyRuns,
  indexRecords,
  linkRuns,
  tableRuns,
  type BuildEnv,
  type Built,
} from './build';
import { createIdMap } from './ids';
import type { ImportTarget } from '../config';
import type { DataPhase } from './registry';
import type { Checkpoint, IdMap, RunBatch, V3DataExport } from './types';

export const DEFAULT_BATCH_SIZE = 500;

export interface ConvertDataOptions {
  /** The project to import into (`convertConfig(v3, { target: 'import' }).target`). */
  readonly target: ImportTarget;
  readonly geo: Geo;
  /** The config version the store holds for the target project. */
  readonly configVersion: number;
  /** Records per batch (instances, or table rows); default 500. */
  readonly batchSize?: number;
  /** v3 id to feature id. Share it with `migrate`, which fills it. */
  readonly ids?: IdMap;
  /** Continue an interrupted conversion: batches before `resume.next` are not built again. */
  readonly resume?: Checkpoint;
}

const chunks = (n: number, size: number): number => Math.ceil(n / size);

export async function* convertData(
  v3: V3DataExport,
  mapping: Mapping,
  options: ConvertDataOptions,
): AsyncGenerator<RunBatch> {
  const size = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const env: BuildEnv = {
    mapping,
    target: options.target,
    geo: options.geo,
    configVersion: options.configVersion,
    ids: options.ids ?? createIdMap(options.resume?.ids),
    index: indexRecords(v3, mapping),
  };
  const from = options.resume?.next ?? 0;
  const plan: {
    phase: DataPhase;
    count: number;
    build: (from: number, to: number) => Built;
    creates: boolean;
  }[] = [
    {
      phase: 'tables',
      count: v3.tableRows.length,
      creates: true,
      build: (a, b) => tableRuns(v3.tableRows.slice(a, b), env),
    },
    {
      phase: 'create',
      count: v3.instances.length,
      creates: true,
      build: (a, b) => createRuns(v3.instances.slice(a, b), env),
    },
    {
      phase: 'history',
      count: v3.instances.length,
      creates: false,
      build: (a, b) => historyRuns(v3.instances.slice(a, b), env),
    },
    {
      phase: 'links',
      count: v3.instances.length,
      creates: false,
      build: (a, b) => linkRuns(v3.instances.slice(a, b), env),
    },
  ];
  let index = 0;
  for (const step of plan) {
    for (let k = 0; k < chunks(step.count, size); k++, index++) {
      if (index < from) continue;
      const built = step.build(k * size, (k + 1) * size);
      // A chunk with nothing to submit still has its index, so indices stay the same when a chunk turns out empty.
      if (built.runs.length === 0 && built.problems.length === 0) continue;
      yield {
        index,
        phase: step.phase,
        runs: built.runs,
        sources: built.sources,
        creates: step.creates,
        problems: built.problems,
      };
    }
  }
}
