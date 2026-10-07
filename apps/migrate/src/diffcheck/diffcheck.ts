/**
 * diffcheck: replays recorded v3 task runs through the converted v4 project (core.plan) and lists every
 * behavioural difference with a reason (apps/migrate/README.md, "Differential check").
 */
import {
  compile,
  NO_ASSETS,
  compilePerms,
  createGeo,
  createPlan,
  oneVersion,
  PLAN_MAX_RULE_DEPTH,
  formApi,
  merge,
  type CompiledConfig,
  type FeatureId,
  type PlanPorts,
  type RunId,
} from '@ueberblick/core';
import { MemoryStore } from '@ueberblick/core/memory';
import type { ConvertResult } from '../config/convert';
import { compareResult } from './compare';
import { explain } from './explain';
import { buildRun } from './replay';
import { seedInstance } from './seed';
import type { Difference, V3Run } from './types';

/** The default time of a run: 2023-11-14, the `now` of the v3 eval-core corpus. */
export const DEFAULT_NOW_MS = 1_700_000_000_000;

/** The config version the replayed runs carry (replay.ts stamps the same). */
const REPLAY_CONFIG_VERSION = 1;

export class DiffcheckConfigError extends Error {}

/** The compiled project of a conversion result (template merged with the overlay). */
export function compileConverted(converted: ConvertResult): CompiledConfig {
  const r = compile(merge(converted.template, converted.overlay).file, { assets: NO_ASSETS });
  if (!r.ok) {
    throw new DiffcheckConfigError(
      `the converted project does not compile: ${r.problems.map((p) => p.code).join(', ')}`,
    );
  }
  return r.config;
}

const planApi = createPlan(formApi);
const uuid = (prefix: number, n: number): string =>
  `${prefix.toString(16).padStart(8, '0')}-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

/**
 * Replay `v3Runs` through `converted` and return the differences (an empty list means v4 agrees with v3 on
 * every run). Each run is replayed on its own: the instance it saw is seeded into a store of its own and
 * the result is read, so the runs may come in any order.
 */
export function diffcheck(v3Runs: readonly V3Run[], converted: ConvertResult): Difference[] {
  const config = compileConverted(converted);
  const perms = compilePerms(config);
  const geo = createGeo();
  const mapping = converted.mapping;
  const out: Difference[] = [];
  let n = 0;

  const skip = (run: V3Run, why: string): void => {
    out.push({
      runId: run.id,
      kind: 'not_replayable',
      cause: 'not_convertible',
      v3: run.recorded.outcome,
      v4: 'not replayed',
      reason: why,
      items: [],
    });
  };

  for (const run of v3Runs) {
    const type = mapping.types[run.workflow] ?? mapping.tables[run.workflow];
    const task = mapping.tasks[`${run.workflow}/${run.task}`];
    if (type === undefined) {
      skip(run, `workflow "${run.workflow}" is not in the converted project`);
      continue;
    }
    if (task === undefined) {
      skip(run, `task "${run.workflow}/${run.task}" is not in the converted project`);
      continue;
    }
    const newId = (): FeatureId => uuid(1, ++n) as FeatureId;
    const now = new Date(run.now ?? DEFAULT_NOW_MS).toISOString();
    // A fresh store per run: the replays are independent, so nothing has to be removed afterwards.
    const world = new MemoryStore(config, { now: () => now }, geo, REPLAY_CONFIG_VERSION);
    const ports: PlanPorts = {
      clock: { now: () => now },
      facts: world,
      geo,
      limits: { ruleDepth: PLAN_MAX_RULE_DEPTH },
    };
    try {
      const seeded = seedInstance(run, type, { mapping, config, world, newId, runId: uuid(3, ++n) as RunId });
      if (seeded.missing !== undefined) {
        skip(run, seeded.missing);
        continue;
      }
      const built = buildRun(run, type, mapping, task, uuid(4, ++n) as RunId, seeded.self);
      if ('missing' in built) {
        skip(run, built.missing);
        continue;
      }
      const result = planApi.planFor([built.run], oneVersion(config, perms), ports);
      if (result.ok)
        world.append(
          built.run.id,
          result.runs.flatMap((r) => r.observations),
        );
      const subject = result.ok ? (result.runs[0]?.created[0] ?? seeded.self) : undefined;
      for (const f of compareResult(run, result, type, world, subject)) {
        out.push(explain({ ...f, runId: run.id }, run, converted));
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      out.push({
        runId: run.id,
        kind: 'outcome',
        cause: 'unexplained',
        v3: run.recorded.outcome,
        v4: 'error',
        reason: message,
        items: [],
      });
    }
  }
  return out;
}
