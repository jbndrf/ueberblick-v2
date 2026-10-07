/**
 * The import job (WP-363): plan the file with `planImport`, retire the old features for a replace, submit through the
 * project's `Store` in steps (`submitPlan`) and keep the progress in `import_jobs`. One job at a time per service:
 * a second one waits, so a replace never interleaves with another import.
 */
import {
  IMPORT_LIMITS,
  LIFECYCLE_TASK,
  type Actor,
  type FeatureId,
  type Geo,
  type Ids,
  type Json,
  type Key,
  type Run,
} from '@ueberblick/core';
import type { Db } from '../../db/driver';
import {
  creationOf,
  planImport,
  submitPlan,
  type ImportDeps,
  type ImportPlan,
  type ImportSource,
} from '../../io';
import type { Store } from '../../store';
import type { DeployedConfig } from '../../sync';
import { insertJob, readJob, updateJob, type JobRow } from './jobs';
import type { ParsedImport } from './parse';

export interface ImportServiceDeps {
  db(projectKey: string): Db;
  store(projectKey: string): Store;
  readonly clock: { now(): string };
  readonly ids: Ids;
  readonly geo: Geo;
}

export interface DryRun {
  readonly counts: { readonly valid: number; readonly problem_rows: number; readonly problems: number };
  readonly problems: ImportPlan['problems'];
  readonly preview: readonly { readonly row: number; readonly values: Readonly<Record<string, Json>> }[];
}

const sourceOf = (p: ParsedImport): ImportSource => ({ format: p.format, data: p.bytes });

/** The import actor: it holds every role of the config, so a task's `when` on roles lets the admin's file through. */
const actorFor = (adminId: string, config: DeployedConfig['config']): Actor => ({
  id: `import:${adminId}`,
  kind: 'import',
  roles: Object.keys(config.file.roles ?? {}) as Key[],
});

const depsFor = (svc: ImportServiceDeps, deployed: DeployedConfig, adminId: string): ImportDeps => ({
  config: deployed.config,
  configVersion: deployed.version,
  actor: actorFor(adminId, deployed.config),
  ids: svc.ids,
  geo: svc.geo,
});

/** What one run writes: a plain run's input, or an `$import` run's values with its constants on top. */
const isObject = (v: Json | undefined): v is { readonly [k: string]: Json } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const writtenValues = (run: Run): Readonly<Record<string, Json>> => {
  const { values, constants } = run.input;
  return isObject(values) ? { ...values, ...(isObject(constants) ? constants : {}) } : run.input;
};

const problemRows = (plan: ImportPlan): number =>
  new Set(plan.problems.filter((p) => p.row > 0).map((p) => p.row)).size;

export function createImportService(svc: ImportServiceDeps) {
  const live = new Set<string>();
  let tail: Promise<void> = Promise.resolve();

  /** The dry run: the file is read and planned in `skip` mode, so counts and problems are complete; nothing is written. */
  function dryRun(deployed: DeployedConfig, adminId: string, parsed: ParsedImport): DryRun {
    const plan = planImport(sourceOf(parsed), parsed.mapping, depsFor(svc, deployed, adminId), {
      mode: 'skip',
    });
    return {
      counts: { valid: plan.runs.length, problem_rows: problemRows(plan), problems: plan.problems.length },
      problems: plan.problems.slice(0, IMPORT_LIMITS.maxProblems),
      preview: plan.runs
        .slice(0, IMPORT_LIMITS.previewRows)
        .map((run, i) => ({ row: plan.rows[i] ?? 0, values: writtenValues(run) })),
    };
  }

  const retire = (db: Db, deployed: DeployedConfig, parsed: ParsedImport, deps: ImportDeps): Run[] => {
    const type = creationOf(parsed.mapping, deployed.config).typeKey;
    if (type === undefined) return [];
    return db
      .prepare<{ id: string }>(
        "SELECT id FROM features WHERE type = ? AND lifecycle != 'deleted' ORDER BY rowid",
      )
      .all(type)
      .map((f) => ({
        id: svc.ids.runId(),
        task: LIFECYCLE_TASK as Key,
        actor: deps.actor,
        configVersion: deps.configVersion,
        featureId: f.id as FeatureId,
        input: { state: 'deleted' },
      }));
  };

  async function execute(
    projectKey: string,
    id: string,
    deployed: DeployedConfig,
    adminId: string,
    parsed: ParsedImport,
  ): Promise<void> {
    const db = svc.db(projectKey);
    const patch = (p: Parameters<typeof updateJob>[2]): void => updateJob(db, id, p, svc.clock.now());
    try {
      patch({ state: 'running' });
      const deps = depsFor(svc, deployed, adminId);
      const mode = parsed.mode ?? 'atomic';
      const plan = planImport(sourceOf(parsed), parsed.mapping, deps, { mode });
      const total = plan.runs.length + problemRows(plan);
      patch({ rows_total: total });
      await new Promise<void>((r) => setImmediate(r));
      const steps = submitPlan(svc.store(projectKey), plan, {
        mode,
        ...(parsed.replace ? { before: retire(db, deployed, parsed, deps) } : {}),
      });
      let result = steps.next();
      while (!result.done) {
        patch({ rows_done: result.value });
        await new Promise<void>((r) => setImmediate(r));
        result = steps.next();
      }
      const outcome = result.value;
      patch({
        state: 'done',
        outcome: outcome.outcome,
        rows_done: total,
        imported: outcome.outcome === 'accepted' ? outcome.imported : 0,
        problems: outcome.problems,
      });
    } catch (e) {
      patch({ state: 'failed', error: e instanceof Error ? e.message : String(e) });
    } finally {
      live.delete(id);
    }
  }

  return {
    dryRun,
    /** Queues the job and returns its id at once; the work runs after the response. */
    start(projectKey: string, deployed: DeployedConfig, adminId: string, parsed: ParsedImport): string {
      const id = svc.ids.runId() as string;
      insertJob(svc.db(projectKey), {
        id,
        mode: parsed.mode ?? 'atomic',
        replace: parsed.replace,
        task: parsed.mapping.task,
        now: svc.clock.now(),
      });
      live.add(id);
      tail = tail.then(() => execute(projectKey, id, deployed, adminId, parsed));
      return id;
    },
    job: (projectKey: string, id: string): JobRow | undefined =>
      readJob(svc.db(projectKey), id, live, svc.clock.now()),
    /** Resolves when every queued job has finished (tests, shutdown). */
    idle: (): Promise<void> => tail,
  };
}

export type ImportService = ReturnType<typeof createImportService>;
