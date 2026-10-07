/**
 * The preview follows the draft (WP-341, A-031 item 2). `schedulePreviewRefresh` is called after every accepted
 * draft save and coalesces per project (the debounce timer is injected); `refreshPreview` deploys the saved draft into
 * the preview store with the automatic value mappings. A draft that does not compile keeps the last good version and
 * makes the status `stale`. It reads the real project database for the draft and writes only the preview database
 * and the preview's row in control.db: nothing of the real project changes.
 */
import {
  merge,
  OverlayFileSchema,
  type Clock,
  type LocalizedString,
  type OverlayFile,
} from '@ueberblick/core';
import { parse } from 'yaml';
import { createDraftStore } from '../builder-draft';
import type { Db } from '../db/driver';
import {
  deployedVersion,
  deployProject,
  loadConfig,
  plan,
  recordedMappings,
  versions,
  type DeployInput,
  type TemplateSource,
  type ValueMapping,
} from '../deploy';
import {
  listPreviewLogins,
  syncPreviewLogins,
  type PreviewLogin,
  type PreviewLoginAuth,
  type PreviewRole,
} from './logins';
import { previewMappings } from './mappings';
import { previewOf, type PreviewStatus } from './registry';

/** The debounce: coalesces saves of ~1 s typing into one deploy. */
export const PREVIEW_DEBOUNCE_MS = 1000;

/** What the status route reports (no logins yet, that is P4). `dropped`: there is no live preview. */
export interface PreviewState {
  readonly status: PreviewStatus;
  /** How many problems the last refused draft had; 0 when ready. */
  readonly problems: number;
  /** The version deployed in the preview, or null without a live preview. */
  readonly version: number | null;
  readonly updatedAt: string | null;
}

export interface PreviewRefreshDeps {
  readonly control: Db;
  readonly clock: Clock;
  readonly templates: TemplateSource;
  /** The real project (id and key), or undefined. Never a preview. */
  project(projectKey: string): { readonly id: string; readonly key: string } | undefined;
  /** The real project's database: where the draft lives. Read only. */
  draftDb(projectKey: string): Db;
  /** Creates the preview on first need (WP-340). */
  ensurePreview(projectId: string): { readonly id: string; readonly key: string };
  /** The preview's database by its served key. */
  previewDb(previewKey: string): Db;
  /** `ProjectServices.afterDeploy` of the preview key: timers and the value-move executor. */
  afterDeploy(previewKey: string): void;
  /** The debounce timer; returns its cancel. A test drives it by hand. */
  schedule(run: () => void, ms: number): () => void;
  readonly debounceMs?: number;
  /**
   * Drops the preview (database, files, sessions; WP-340). The reset calls it with `keepLogins` (the tokens stay,
   * WP-373), then deploys and seeds again.
   */
  dropPreview?(projectId: string, opts?: { readonly keepLogins?: boolean }): void;
  /** The auth module: the preview logins (WP-373, A-031 item 4). */
  auth: PreviewLoginAuth;
  /**
   * Seeds the freshly deployed, still empty preview with demo data (WP-342); absent: no demo data. `participant` is a
   * preview login the generated participant values point to.
   */
  seed?(previewKey: string, participant: string): void;
  /** A refresh that threw (not a refused draft): the state stays as it was. */
  onError?(projectKey: string, error: unknown): void;
}

export interface PreviewRefresher {
  /** Debounced, coalesced per project. Called after an accepted draft save. */
  schedulePreviewRefresh(projectKey: string): void;
  /** Deploys the saved draft into the preview now. */
  refreshPreview(projectKey: string): PreviewState;
  previewState(projectKey: string): PreviewState;
  /** "Demo-Daten zurücksetzen": drops the preview, deploys the draft into a new one and seeds it (WP-342); the logins stay. */
  resetPreview(projectKey: string): PreviewState;
  /**
   * After a deploy of the real project (publish, rollback, upgrade, admin deploy; A-034): moves the preview's data to the
   * new config with the same `{ to }` mappings the live deploy recorded, instead of discarding the preview (A-031 item
   * 5). Nothing happens without a preview. It follows the draft, or the live config when there is none.
   */
  carryOver(projectKey: string): void;
  /** The preview logins of a project, roles of the deployed draft first, "Keine Rolle" last; none without a preview. */
  previewLogins(projectKey: string, locale?: string): readonly PreviewLogin[];
}

const NONE: PreviewState = { status: 'dropped', problems: 0, version: null, updatedAt: null };

/** The draft text as an overlay file, or the number of problems that stop it. */
function parseDraft(text: string): OverlayFile | number {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch {
    return 1;
  }
  const r = OverlayFileSchema.safeParse(doc);
  return r.success ? r.data : r.error.issues.length;
}

export function createPreviewRefresher(deps: PreviewRefreshDeps): PreviewRefresher {
  const pending = new Map<string, () => void>();
  const last = new Map<string, { problems: number; updatedAt: string }>();

  const realProject = (key: string): { readonly id: string; readonly key: string } => {
    const p = deps.project(key);
    if (!p) throw new Error(`unknown project: ${key}`);
    return p;
  };

  /**
   * What the preview is doing. A project with a draft but no preview yet (made from a template, nothing saved since)
   * gets its preview on the first ask, so the logins are there before any publish (WP-505, v3's "Vorschau" before "Release").
   */
  function previewState(projectKey: string): PreviewState {
    const project = realProject(projectKey);
    let row = previewOf(deps.control, project.id);
    if ((!row || row.status === 'dropped') && createDraftStore(deps.draftDb(projectKey)).get()) {
      refreshPreview(projectKey);
      row = previewOf(deps.control, project.id);
    }
    if (!row || row.status === 'dropped') return NONE;
    const db = deps.previewDb(row.key);
    const running = deployedVersion(db);
    const memory = last.get(projectKey);
    return {
      status: row.status,
      problems: row.status === 'stale' ? (memory?.problems ?? 0) : 0,
      version: running?.version ?? null,
      updatedAt:
        memory?.updatedAt ?? versions(db).find((v) => v.version === running?.version)?.createdAt ?? null,
    };
  }

  const setStatus = (projectId: string, status: PreviewStatus): void => {
    deps.control.prepare('UPDATE previews SET status = ? WHERE project_id = ?').run(status, projectId);
  };

  /** The roles of the preview's deployed config: what the logins follow. */
  const rolesOf = (db: Db): PreviewRole[] =>
    Object.entries(loadConfig(db)?.file.roles ?? {}).map(([key, role]) => ({
      key,
      label: (role as { label?: LocalizedString }).label,
    }));

  /** Deploys `file` into the preview; `moves` (the live deploy's mappings) win over the automatic ones. */
  function deployInto(
    projectKey: string,
    file: DeployInput,
    moves: Readonly<Record<string, ValueMapping>>,
  ): PreviewState {
    const project = realProject(projectKey);
    const preview = deps.ensurePreview(project.id);
    const stale = (problems: number): PreviewState => {
      setStatus(project.id, 'stale');
      last.set(projectKey, { problems, updatedAt: deps.clock.now() });
      return previewState(projectKey);
    };
    const db = deps.previewDb(preview.key);
    const pipeline = { clock: deps.clock, templates: deps.templates };
    const dry = plan(db, file, pipeline);
    if (!dry.ok) return stale(dry.problems.length);
    const base = 'extends' in file ? deps.templates.resolve(file.extends) : file;
    const effective = 'extends' in file ? (base ? merge(base, file).file : undefined) : file;
    const mappings = effective ? { ...previewMappings(dry.diff, effective), ...moves } : { ...moves };
    const r = deployProject(
      db,
      file,
      'preview',
      { ...pipeline, afterDeploy: () => deps.afterDeploy(preview.key) },
      mappings,
    );
    if (!r.ok) return stale(r.problems.length);
    const row = previewOf(deps.control, project.id);
    // The logins first: the demo data's participant values point to one of them.
    const logins = row ? syncPreviewLogins(deps.auth, db, preview.id, row.generation, rolesOf(db)) : [];
    // The first deploy of an empty preview seeds it; a later one never does (shape changes use the mappings).
    const first = logins.find((l) => l.role !== null) ?? logins[0];
    if (deps.seed && first && db.prepare<{ n: number }>('SELECT count(*) AS n FROM runs').get()?.n === 0)
      deps.seed(preview.key, first.id);
    setStatus(project.id, 'ready');
    last.set(projectKey, { problems: 0, updatedAt: deps.clock.now() });
    return previewState(projectKey);
  }

  function refreshPreview(projectKey: string): PreviewState {
    const draft = createDraftStore(deps.draftDb(projectKey)).get();
    if (!draft) return previewState(projectKey);
    const file = parseDraft(draft.overlay);
    if (typeof file !== 'number') return deployInto(projectKey, file, {});
    const project = realProject(projectKey);
    deps.ensurePreview(project.id);
    setStatus(project.id, 'stale');
    last.set(projectKey, { problems: file, updatedAt: deps.clock.now() });
    return previewState(projectKey);
  }

  function resetPreview(projectKey: string): PreviewState {
    const project = realProject(projectKey);
    deps.dropPreview?.(project.id, { keepLogins: true });
    return refreshPreview(projectKey);
  }

  function carryOver(projectKey: string): void {
    try {
      const project = deps.project(projectKey);
      const row = project && previewOf(deps.control, project.id);
      if (!row || row.status === 'dropped') return;
      pending.get(projectKey)?.();
      pending.delete(projectKey);
      const live = deps.draftDb(projectKey);
      const running = deployedVersion(live);
      if (!running) return;
      const draft = createDraftStore(live).get();
      const parsed = draft ? parseDraft(draft.overlay) : undefined;
      const file = typeof parsed === 'object' ? parsed : loadConfig(live, running.version)?.file;
      if (file) deployInto(projectKey, file, recordedMappings(live, running.version));
    } catch (e) {
      // A live deploy never fails because of its preview: the next draft save refreshes it.
      deps.onError?.(projectKey, e);
    }
  }

  function previewLogins(projectKey: string, locale = 'en'): readonly PreviewLogin[] {
    const project = realProject(projectKey);
    const row = previewOf(deps.control, project.id);
    if (!row || row.status === 'dropped') return [];
    return listPreviewLogins(deps.auth, row.id, row.generation, rolesOf(deps.previewDb(row.key)), locale);
  }

  function schedulePreviewRefresh(projectKey: string): void {
    pending.get(projectKey)?.();
    const cancel = deps.schedule(() => {
      pending.delete(projectKey);
      try {
        refreshPreview(projectKey);
      } catch (e) {
        deps.onError?.(projectKey, e);
      }
    }, deps.debounceMs ?? PREVIEW_DEBOUNCE_MS);
    pending.set(projectKey, cancel);
  }

  return { schedulePreviewRefresh, refreshPreview, previewState, resetPreview, carryOver, previewLogins };
}
