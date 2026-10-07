/**
 * The process-wide adapters: control.db, the auth service and lazily opened project databases, plus the per-project
 * services that share them (run store hooks, doorbell, sync, timers). This is the composition root of the server;
 * handlers get everything from here.
 *
 * A project has exactly one `Store`, from `projectStoresFor(runtime())`: its `hooks` attach the timers hook in the run
 * transaction and its `doorbell` rings sync listeners after a commit. The timers loop (`tick` every
 * `TIMERS_INTERVAL_S` seconds, default 30, `0` = off) starts with the runtime and stops on shutdown.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config';
import { projectPaths, type ProjectPaths } from './runtime-paths';
import {
  controlTemplateSource,
  createAuth,
  createLogger,
  expireGuests,
  createPackRuntime,
  createGuard,
  createTileService,
  createPreviewRefresher,
  createProjectServices,
  dropPreview,
  ensurePreview,
  findPreview,
  isPreviewKey,
  loadConfig,
  seedPreview,
  previewDbPath,
  previewKeys,
  openProjectDbFile,
  fileBlobStore,
  httpFetchRange,
  packsDir,
  sweepStaleTileUploads,
  tileUserAgent,
  withRetries,
  openControlDb,
  participantRolesOf,
  openProjectDb,
  projectStoresFor,
  startTimersLoop,
  sweepRetiredProjects,
  type Auth,
  type AuthDeps,
  type BlobLimits,
  type Db,
  type Doorbell,
  type FetchRange,
  type Logger,
  type PackRuntime,
  type LoggerOptions,
  type LogLevel,
  type PreviewRefresher,
  type PreviewRefreshDeps,
  type ProjectServices,
  type ProjectStoresDeps,
  type TemplateSource,
  type TileService,
  type TimersLoopDeps,
  type TransactionHook,
} from '@ueberblick/server';

export interface Runtime extends ProjectPaths {
  readonly control: Db;
  readonly auth: Auth;
  readonly templates: TemplateSource;
  readonly clock: { now(): string };
  /** The one logger of this process (docs/process/logging.md). Every service that logs gets this object. */
  readonly log: Logger;
  /** `Secure` cookies are the default; only plain-http local runs turn them off. */
  readonly secureCookies: boolean;
  /** The project row for a key, or undefined. */
  project(key: string): { readonly id: string; readonly key: string } | undefined;
  /**
   * The project a participant route serves: a real project or a live preview (`<key>__vorschau`, A-031). Only the
   * participant routes call it; `project` never returns a preview, so every other surface stays blind to them.
   */
  participantProject(key: string): { readonly id: string; readonly key: string } | undefined;
  /** The id, key and display name of the project (or live preview) a participant session belongs to. Participant routes only. */
  participantProjectOf(
    id: string,
  ): { readonly id: string; readonly key: string; readonly name: string } | undefined;
  /** The preview follows the draft: debounced refresh after a draft save, status for the builder (WP-341). */
  readonly previews: PreviewRefresher;
  /** Creates the project's preview (row and migrated database) or returns it; idempotent. */
  ensurePreview(projectId: string): { readonly id: string; readonly key: string };
  /** Closes the preview's handle, removes its files, sessions and logins, bumps its generation. */
  dropPreview(projectId: string, opts?: { readonly keepLogins?: boolean }): void;
  /** The data folder (`DATA_DIR`); thumbnails live under `<dataDir>/blobs/<project>/thumbs`. */
  readonly dataDir: string;
  /** The keys of every project. */
  projectKeys(): readonly string[];
  /** The project's database, opened on first use and kept open. */
  projectDb(key: string): Db;
  /** Sync, doorbell and timers of each project, over the same databases and configs. */
  readonly services: ProjectServices;
  /** `ProjectStoresDeps`: the hooks of a project's store. Register more here (outbox) and they run in the run transaction. */
  hooks(project: { readonly key: string; readonly db: Db }): readonly TransactionHook[];
  /** `ProjectStoresDeps`: the bell every accepted run of a project's store rings. */
  doorbell(projectKey: string): Doorbell;
  /** `ProjectStoresDeps`, required: blob bytes under `<dataDir>/blobs/<project>`; an erasure deletes them after its commit, a store sweeps interrupted deletes when it opens. */
  readonly blobs: ProjectStoresDeps['blobs'];
  /** Upload limit of the blob route; absent: `DEFAULT_BLOB_LIMITS`. */
  readonly blobLimits?: Partial<BlobLimits>;
  /** The offline pack builders (WP-351): `kick` after a deploy or a rebuild; one drain per project at a time. */
  readonly packs: PackRuntime;
  /** The tile proxy (A-033, WP-369): the disk cache and the per-host limiter that map tiles and pack builds share. */
  readonly tiles: TileService;
  /** Stops the timers loop and aborts the pack builds; safe to call twice. */
  stop(): void;
}

export interface RuntimeOptions {
  readonly dataDir: string;
  readonly secureCookies: boolean;
  /** Admin sign-in (`ADMIN_TOTP`, `SESSION_DAYS_ADMIN_REMEMBER`); undefined: TOTP required, 30 days (tests). */
  readonly admin?: AuthDeps['admin'];
  /** Beat of the timers loop in ms. Undefined or 0: no loop (tests, tools that only read). */
  readonly timersIntervalMs?: number;
  /** Test seams: the wall clock and the beat. */
  readonly now?: () => Date;
  readonly every?: TimersLoopDeps['every'];
  /** Lowest log level written (`UEBERBLICK_LOG_LEVEL`, via `config/`); default `info`. */
  readonly logLevel?: LogLevel;
  /** Test seams: where a log line goes (default: one line on stdout) and the logger factory. */
  readonly sink?: LoggerOptions['sink'];
  readonly makeLogger?: typeof createLogger;
  /** Test seam: the preview refresh's debounce timer (default: `setTimeout`, unref'd). */
  readonly schedulePreview?: PreviewRefreshDeps['schedule'];
  readonly onTimerError?: TimersLoopDeps['onError'];
  /** Upload limit of the blob route (WP-942 feeds it from `.env`). */
  readonly blobLimits?: Partial<BlobLimits>;
  /** Build offline packs in the background (`PACK_BUILD`, default on). Tests that do not test packs pass false. */
  readonly packBuild?: boolean;
  /** The instance origin, named in the User-Agent of the tile fetches (`PUBLIC_URL`). */
  readonly origin?: string;
  /** Test seam: where pack tiles come from (default: HTTP range requests, two at a time, with retries). */
  readonly packFetch?: FetchRange;
  /** Test seam: the HTTP client of the tile proxy (default: global `fetch`). */
  readonly tileFetch?: typeof fetch;
}

/**
 * `*.restoring` files in the data dir mean a backup restore did not finish (`scripts/backup/replay.mjs`, docs/process/backup.md).
 * Booting would create an empty database for every missing name, so the start is refused. Reads the dir only.
 */
export function assertNoRestoreInProgress(dataDir: string): void {
  if (!existsSync(dataDir)) return;
  const files = readdirSync(dataDir)
    .filter((f) => f.endsWith('.restoring'))
    .sort();
  if (files.length === 0) return;
  throw new Error(
    `Refusing to start: a restore is unfinished in ${dataDir} (${files.join(', ')}). ` +
      'Finish it (rename the remaining .restoring files) or delete them and run `npm run backup:restore` again ' +
      '(docs/process/backup.md).',
  );
}

export function createRuntime(opts: RuntimeOptions): Runtime {
  assertNoRestoreInProgress(opts.dataDir);
  mkdirSync(opts.dataDir, { recursive: true });
  const control = openControlDb(join(opts.dataDir, 'control.db'));
  const now = opts.now ?? ((): Date => new Date());
  const clock = { now: () => now().toISOString() };
  const log = (opts.makeLogger ?? createLogger)({
    sink: opts.sink ?? ((line) => process.stdout.write(`${line}\n`)),
    now: () => now().getTime(),
    ...(opts.logLevel ? { minLevel: opts.logLevel } : {}),
  });
  const open = new Map<string, Db>();
  const projectDb = (key: string): Db => {
    let db = open.get(key);
    if (!db) {
      if (isPreviewKey(key)) {
        // Only a live preview opens, and from its own file: `project-<key>.db` is never created for it.
        const preview = findPreview(control, key);
        if (!preview) throw new Error(`unknown preview: ${key}`);
        const base = control
          .prepare<{ key: string }>('SELECT key FROM projects WHERE id = ?')
          .get(preview.projectId);
        if (!base) throw new Error(`unknown preview: ${key}`);
        db = openProjectDbFile(previewDbPath(opts.dataDir, base.key));
      } else db = openProjectDb(opts.dataDir, key);
      open.set(key, db);
    }
    return db;
  };
  const projectKeys = (): string[] =>
    control
      .prepare<{ key: string }>('SELECT key FROM projects ORDER BY key')
      .all()
      .map((r) => r.key);
  const services = createProjectServices({
    clock,
    log,
    projectDb,
    store: (key) => projectStoresFor(rt)(key),
  });
  // Read live from participants.roles on every authenticate: no cache, so a role change or a disabled
  // participant applies on the next request.
  const participantRoles = (projectId: string, participantId: string) => {
    const row = control.prepare<{ key: string }>('SELECT key FROM projects WHERE id = ?').get(projectId);
    if (row) return participantRolesOf(projectDb(row.key), participantId);
    // A preview session's project id is the preview's id (A-031 item 6).
    const preview = control
      .prepare<{ key: string }>("SELECT key FROM previews WHERE id = ? AND status != 'dropped'")
      .get(projectId);
    return preview ? participantRolesOf(projectDb(preview.key), participantId) : null;
  };
  const userAgent = tileUserAgent(opts.origin);
  // One SSRF guard for every request to a layer's host: the proxy, the pack tiles and the pack range fetches.
  const tileSeam = opts.tileFetch;
  const guard = createGuard({
    ...(opts.origin ? { ownHost: new URL(opts.origin).hostname } : {}),
    ...(tileSeam ? { transport: (u: string, i: RequestInit) => tileSeam(u, i) } : {}),
  });
  const rangeFetch =
    opts.packFetch ??
    withRetries(
      httpFetchRange({
        userAgent,
        concurrency: 2,
        fetch: guard.fetch as typeof fetch,
        ...(opts.origin ? { baseUrl: opts.origin } : {}),
      }),
    );
  // One tile service for the process: map requests and pack builds share its cache and its per-host limiter.
  const tiles = createTileService({
    root: join(opts.dataDir, 'tiles-cache'),
    fetchRange: rangeFetch,
    userAgent,
    guard,
  });
  const packs = createPackRuntime({
    enabled: opts.packBuild ?? true,
    clock,
    fetchRange: rangeFetch,
    ...(opts.packFetch ? {} : { guard }), // a test seam stands for the whole network, DNS included
    tiles: (project) => (source, z, x, y) => tiles.tile({ project, source, z, x, y }),
    projectDb,
    file: (key) => services.deployed(key)?.config.file,
    dir: (key) => packsDir(opts.dataDir, key),
    onError: (key, info) => log.log('packs.failed', { projectKey: key, code: info.code }),
  });
  // A deploy changes what the packs need (the config's `map.packs`): queue and build them. Previews never build packs.
  const afterDeploy = services.afterDeploy.bind(services);
  const auth = createAuth({ control, now, participantRoles, ...(opts.admin ? { admin: opts.admin } : {}) });
  services.afterDeploy = (key) => {
    afterDeploy(key);
    if (isPreviewKey(key)) return;
    packs.kick(key);
    // The preview is not discarded on a deploy: its data moves with the live deploy's moves (WP-373, A-034).
    rt.previews.carryOver(key);
  };
  const rt: Runtime = {
    control,
    auth,
    templates: controlTemplateSource(control),
    clock,
    log,
    secureCookies: opts.secureCookies,
    project: (key) =>
      control.prepare<{ id: string; key: string }>('SELECT id, key FROM projects WHERE key = ?').get(key),
    participantProject: (key) => {
      const real = rt.project(key);
      if (real) return real;
      const preview = findPreview(control, key);
      return preview ? { id: preview.id, key: preview.key } : undefined;
    },
    participantProjectOf: (id) => {
      const real = control
        .prepare<{ id: string; key: string; name: string }>('SELECT id, key, name FROM projects WHERE id = ?')
        .get(id);
      if (real) return real;
      const preview = control
        .prepare<{ id: string; key: string; name: string }>(
          "SELECT p.id, p.key, r.name FROM previews p JOIN projects r ON r.id = p.project_id WHERE p.id = ? AND p.status != 'dropped'",
        )
        .get(id);
      return preview;
    },
    previews: createPreviewRefresher({
      control,
      clock,
      templates: controlTemplateSource(control),
      project: (key) => rt.project(key),
      draftDb: (key) => projectDb(key),
      ensurePreview: (projectId) => rt.ensurePreview(projectId),
      previewDb: (key) => projectDb(key),
      afterDeploy: (key) => services.afterDeploy(key),
      dropPreview: (projectId, o) => rt.dropPreview(projectId, o),
      auth,
      seed: (key, participant) => {
        const db = projectDb(key);
        const compiled = loadConfig(db);
        if (compiled) seedPreview(db, compiled, { clock, log, participant, seed: now().getTime() });
      },
      schedule:
        opts.schedulePreview ??
        ((fn, ms) => {
          const t = setTimeout(fn, ms);
          t.unref();
          return () => clearTimeout(t);
        }),
      onError: (key) => log.log('preview.refresh_failed', { projectKey: key, code: 'refresh_threw' }),
    }),
    ensurePreview: (projectId) => ensurePreview(control, opts.dataDir, projectId, clock),
    dropPreview: (projectId, o) => {
      const row = control
        .prepare<{ key: string }>('SELECT key FROM previews WHERE project_id = ?')
        .get(projectId);
      if (row) {
        open.get(row.key)?.close();
        open.delete(row.key);
        // The services and the store hold the closed handle: they open the new file on their next use.
        services.forget(row.key);
        projectStoresFor(rt).forget(row.key);
      }
      dropPreview(control, opts.dataDir, projectId, o);
    },
    dataDir: opts.dataDir,
    projectKeys,
    projectDb,
    services,
    blobs: {
      store: (key) => fileBlobStore(join(opts.dataDir, 'blobs', key)),
      // A byte delete that fails leaves personal data on disk: an error line (no message: it can carry paths).
      // The next start's sweep retries it.
      onError: (key) => log.log('blob.delete_failed', { projectKey: key, code: 'delete_failed' }),
    },
    ...(opts.blobLimits ? { blobLimits: opts.blobLimits } : {}),
    hooks: services.hooks,
    doorbell: services.doorbell,
    packs,
    ...projectPaths(opts.dataDir),
    tiles,
    stop: () => {
      loop?.stop();
      packs.stop();
    },
  };
  // Files of deleted projects whose removal failed (A-037): finished now; a failure is logged, never thrown.
  sweepRetiredProjects({
    control,
    dataDir: opts.dataDir,
    onError: (key) => log.log('blob.delete_failed', { projectKey: key, code: 'delete_failed' }),
  });
  // Value moves of a deploy that a restart interrupted continue now (WP-307).
  for (const key of projectKeys()) {
    services.resumeMoves(key);
    packs.kick(key); // builds that a restart interrupted continue; the queue of a missed deploy is filled
  }
  // Tile uploads an admin left half-sent are removed (WP-405); a failure is logged, never thrown.
  sweepStaleTileUploads(rt, projectKeys(), (key) =>
    log.log('tiles.sweep_failed', { projectKey: key, code: 'sweep_threw' }),
  );
  const loop =
    opts.timersIntervalMs === undefined || opts.timersIntervalMs <= 0
      ? undefined
      : startTimersLoop({
          clock,
          projects: projectKeys,
          previews: () => previewKeys(control),
          timers: services.timers,
          guests: (key) => {
            const project = rt.participantProject(key);
            if (project) expireGuests({ db: projectDb(key), auth: rt.auth, projectId: project.id, now });
          },
          intervalMs: opts.timersIntervalMs,
          ...(opts.every ? { every: opts.every } : {}),
          onError:
            opts.onTimerError ?? ((key) => log.log('timers.failed', { projectKey: key, code: 'tick_threw' })),
        });
  return rt;
}

let shared: Runtime | undefined;

/** The one runtime of this process, created on first use from the parsed config (`config/`: the only reader of the environment). */
export function runtime(): Runtime {
  if (shared === undefined) {
    const c = config();
    shared = createRuntime({
      dataDir: c.dataDir,
      secureCookies: c.secureCookies,
      admin: { totp: c.adminTotp, rememberMs: c.sessionDays.adminRemember * 24 * 3600_000 },
      timersIntervalMs: c.timersIntervalMs,
      logLevel: c.logLevel,
      packBuild: c.packBuild,
      origin: c.publicUrl,
    });
    // adapter-node emits this on SIGTERM/SIGINT before it exits
    process.once('sveltekit:shutdown', () => shared?.stop());
  }
  return shared;
}
