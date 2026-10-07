/** Test helpers for the run store: golden configs, a store over an in-memory project database, seeds, actors. */
import { createVersionCache } from './config-for';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  compile,
  createGeo,
  everyone,
  formApi,
  merge,
  PLAN_MAX_RULE_DEPTH,
  OverlayFileSchema,
  TemplateFileSchema,
  type Actor,
  type CompiledConfig,
  type FeatureId,
  type Geo,
  type Json,
  type Key,
  type PlanLimits,
  type RecordedObservation,
  type Run,
  type RunId,
  type TemplateFile,
} from '@ueberblick/core';
import type { Db } from '../../db/driver';
import { openProjectDb } from '../../db/open';
import { createFacts } from '../facts';
import { createProjector } from './projection';
import { createStore } from './index';
import type { Store, StoreDeps, TransactionHook } from './contract';
import { goldenAssets } from '@ueberblick/core/testing';
import { logSpy, type LogSpy } from './log.testkit';

export const NOW = '2026-05-01T08:00:00.000Z';
const GOLDEN = fileURLToPath(new URL('../../../../../fixtures/golden/', import.meta.url));
const read = (rel: string): unknown => parse(readFileSync(`${GOLDEN}${rel}`, 'utf8'));

/** A golden project (overlay merged onto the newest template of the extended major) compiled. */
export function golden(project: string): CompiledConfig {
  const overlay = OverlayFileSchema.parse(read(`projects/${project}.yaml`));
  const [name, major] = overlay.extends.split('@') as [string, string];
  const versions = readdirSync(`${GOLDEN}templates/${name}`)
    .map((f) => f.replace(/\.yaml$/, ''))
    .filter((v) => v.startsWith(`${major}.`))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const base = TemplateFileSchema.parse(read(`templates/${name}/${versions[versions.length - 1]}.yaml`));
  return buildRaw(merge(base, overlay).file);
}

/** An automatic action to add to (or replace in) a file: `[task, name, entry]` for `tasks.<task>.auto.<name>`. */
export type AutoAdd = readonly [task: string, name: string, entry: Record<string, unknown>];

/** `file` with the automatic actions `adds` set and `drops` (`[task, name]`) removed; `file` itself is untouched. */
export function withAuto(
  file: TemplateFile,
  adds: readonly AutoAdd[] = [],
  drops: readonly (readonly [string, string])[] = [],
  extraTasks: Record<string, unknown> = {},
): TemplateFile {
  const f = structuredClone(file) as unknown as { tasks: Record<string, { auto?: Record<string, unknown> }> };
  Object.assign(f.tasks, structuredClone(extraTasks));
  for (const [task, name, entry] of adds) {
    const t = f.tasks[task];
    if (t === undefined) throw new Error(`no task ${task}`);
    t.auto = { ...t.auto, [name]: entry };
  }
  for (const [task, name] of drops) {
    const t = f.tasks[task];
    if (t?.auto !== undefined)
      t.auto = Object.fromEntries(Object.entries(t.auto).filter(([k]) => k !== name));
  }
  return f as unknown as TemplateFile;
}

/** Compiles a file as it is (a golden template keeps the `who` it names). */
export function buildRaw(file: TemplateFile): CompiledConfig {
  const r = compile(TemplateFileSchema.parse(file), { assets: goldenAssets });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.config;
}

/** Compiles a hand-made file; its tasks without `who` are open to every role (`everyone`, C-004 step 3). */
export const build = (file: TemplateFile): CompiledConfig => buildRaw(everyone(structuredClone(file)));

export const actor = (kind: Actor['kind'], id: string, roles: readonly string[] = []): Actor => ({
  id,
  kind,
  roles: roles as readonly Key[],
});
export const anna = actor('participant', 'anna', ['kontrolle']);
export const bernd = actor('participant', 'bernd', ['bauhof']);
export const vera = actor('participant', 'vera', ['verwaltung']);
export const admin = actor('admin', 'root');

export const uuid = (prefix: number, n: number): string =>
  `${String(prefix).padStart(8, '0')}-0000-7000-8000-${String(n).padStart(12, '0')}`;
export const fid = (n: number): FeatureId => uuid(0, n) as FeatureId;
export const rid = (n: number): RunId => uuid(1, n) as RunId;

export interface Ctx {
  readonly db: Db;
  readonly store: Store;
  readonly deps: StoreDeps;
  /** The log lines the store wrote (`run.committed`, `run.refused`). */
  readonly logs: LogSpy;
  readonly config: CompiledConfig;
  readonly minted: { n: number };
  /** A run with a fresh id. */
  run(task: string, who: Actor, input?: Record<string, Json>, feature?: FeatureId, extra?: Partial<Run>): Run;
  /** Facts as an import: features with their observations, folded by the store's own projection (no plan). */
  /** Facts as an import from already recorded observations (ascending seq, after the current head). */
  seedObservations(obs: readonly RecordedObservation[]): void;
  seed(list: readonly { id: FeatureId; type: string; properties: Readonly<Record<string, Json>> }[]): void;
}

export interface SetupOptions {
  readonly config?: CompiledConfig;
  readonly hooks?: readonly TransactionHook[];
  readonly version?: number;
  /**
   * More stored versions (A-029): `config` stays the one `version` names (default 1), these are the others, by number.
   * With `deployed`, a `config_versions` row marks that version deployed (the compiled form is never read: `config` is injected).
   */
  readonly configs?: ReadonlyMap<number, CompiledConfig>;
  readonly deployed?: number;
  /** The `configCacheSize` of the store. */
  readonly configCacheSize?: number;
  readonly clock?: { now(): string };
  readonly limits?: PlanLimits;
  readonly geo?: Geo;
}

export function setup(opts: SetupOptions = {}): Ctx {
  const config = opts.config ?? golden('musterstadt-plain');
  const version = opts.version ?? 1;
  const db = openProjectDb(':memory:', 'test');
  const geo = opts.geo ?? createGeo();
  const minted = { n: 1000 };
  const logs = logSpy();
  const configOf = (v: number) => (v === version ? config : opts.configs?.get(v));
  const deps: StoreDeps = {
    clock: opts.clock ?? { now: () => NOW },
    log: logs.log,
    ids: { runId: () => rid(++minted.n), featureId: () => fid(++minted.n) },
    geo,
    limits: opts.limits ?? { ruleDepth: PLAN_MAX_RULE_DEPTH },
    config: configOf,
    versions: createVersionCache(configOf, opts.configCacheSize),
    form: formApi,
    ...(opts.hooks ? { hooks: opts.hooks } : {}),
  };
  markDeployed(db, opts.deployed ?? version);
  const store = createStore(db, deps);
  let n = 0;
  const projector = createProjector(db, deps, createFacts(db, new Map()));
  const seedObservations = (obs: readonly RecordedObservation[]): void => {
    db.transaction(() => {
      const runId = rid(900_000 + headSeq(db));
      db.prepare(
        `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome)
         VALUES (?, 'seed', 'import', 'seed', ?, '{}', ?, 'accepted')`,
      ).run(runId, version, deps.clock.now());
      const put = db.prepare(
        'INSERT INTO observations (seq, run_id, feature_id, property, result) VALUES (?, ?, ?, ?, ?)',
      );
      const own = obs.map((o) => ({ ...o, runId }));
      for (const o of own) put.run(o.seq, o.runId, o.featureId, o.property, JSON.stringify(o.result));
      projector.project(
        { deployed: version, config: () => config },
        own,
        own[own.length - 1]?.seq ?? headSeq(db),
      );
    });
  };
  return {
    db,
    store,
    deps,
    logs,
    config,
    minted,
    run: (task, who, input = {}, feature, extra = {}) =>
      ({
        id: rid(++n),
        task: task as Key,
        actor: who,
        configVersion: version,
        input,
        ...(feature !== undefined ? { featureId: feature } : {}),
        ...extra,
      }) as Run,
    seed(list) {
      let seq = headSeq(db);
      const obs: RecordedObservation[] = list.flatMap((f) =>
        [['$type', f.type], ...Object.entries(f.properties)].map(([property, result]) => ({
          featureId: f.id,
          property: property as string,
          result: result as Json,
          seq: ++seq,
          runId: rid(900_000),
        })),
      );
      seedObservations(obs);
    },
    seedObservations,
  };
}

/** A `config_versions` row that makes `version` the deployed one (the stored form is a stub: tests inject the configs). */
export function markDeployed(db: Db, version: number): void {
  db.prepare("UPDATE config_versions SET status = 'retired' WHERE status = 'deployed'").run();
  db.prepare(
    `INSERT INTO config_versions (version, schema, overlay, compiled, hash, status, created_at)
     VALUES (?, 'ueberblick/1', '{}', '{}', ?, 'deployed', '2026-05-01T08:00:00.000Z')
     ON CONFLICT (version) DO UPDATE SET status = 'deployed'`,
  ).run(version, `h${version}`);
}

export function headSeq(db: Db): number {
  return (
    db
      .prepare<{ seq: number }>(
        'SELECT max(coalesce((SELECT max(seq) FROM observations), 0), coalesce((SELECT max(seq) FROM tombstones), 0)) AS seq',
      )
      .get()?.seq ?? 0
  );
}

const square = (x0: number, y0: number, x1: number, y1: number): Json => ({
  type: 'Polygon',
  coordinates: [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
  ],
});

/** The seeded park (with a hole), a species and trees of `fixtures/golden/seeds/musterstadt-geo.yaml`. */
export const IDS = { park: fid(1), linde: fid(2), t_in: fid(3), t_hole: fid(4), t_out: fid(5) } as const;
export function seedMusterstadt(ctx: Ctx): void {
  const park: Json = {
    type: 'Polygon',
    coordinates: [
      [
        [7.1, 50.73],
        [7.11, 50.73],
        [7.11, 50.74],
        [7.1, 50.74],
        [7.1, 50.73],
      ],
      [
        [7.104, 50.734],
        [7.104, 50.736],
        [7.106, 50.736],
        [7.106, 50.734],
        [7.104, 50.734],
      ],
    ],
  };
  ctx.seed([
    { id: IDS.linde, type: 'baumart', properties: { name_de: 'Linde', name_lat: 'Tilia' } },
    { id: IDS.park, type: 'flaeche', properties: { name: 'Spielplatz Nord', geometrie: park } },
    {
      id: IDS.t_in,
      type: 'baum',
      properties: {
        geometrie: { type: 'Point', coordinates: [7.102, 50.732] },
        art: IDS.linde,
        stage: 'erfasst',
        vitalitaet: 'v2',
        befund: 'unauffällig',
        zustaendig: 'anna',
        faellig_am: '2026-04-01',
      },
    },
    {
      id: IDS.t_hole,
      type: 'baum',
      properties: {
        geometrie: { type: 'Point', coordinates: [7.105, 50.735] },
        stage: 'erfasst',
        vitalitaet: 'v1',
      },
    },
    {
      id: IDS.t_out,
      type: 'baum',
      properties: {
        geometrie: { type: 'Point', coordinates: [7.12, 50.75] },
        stage: 'erfasst',
        vitalitaet: 'v4',
        faellig_am: '2026-06-01',
      },
    },
  ]);
}
export { square };

/** Canonical dump of everything a submit may change, for "wrote nothing" checks. */
export function dumpAll(db: Db): string {
  const rows = (sql: string): unknown[] => db.prepare(sql).all();
  return JSON.stringify({
    runs: rows('SELECT * FROM runs ORDER BY id'),
    observations: rows('SELECT * FROM observations ORDER BY seq'),
    features: rows('SELECT * FROM features ORDER BY id'),
    edges: rows('SELECT * FROM edges ORDER BY from_id, relation, to_id'),
    bbox: rows('SELECT * FROM feature_bbox ORDER BY rid'),
    tombstones: rows('SELECT * FROM tombstones ORDER BY seq'),
    outbox: rows('SELECT * FROM outbox ORDER BY id'),
    timers: rows('SELECT * FROM timers ORDER BY feature_id, rule'),
  });
}
