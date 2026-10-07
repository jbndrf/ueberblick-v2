/**
 * Project delete (WP-388, A-037, v3 `deleteProject`): `DELETE /api/admin/projects/<project>` removes everything of
 * a project, and `GET /api/admin/projects/<project>` answers the counts the confirm dialog shows ("Wird ebenfalls
 * gelöscht", v3 `DangerZoneSection.svelte:44-81`).
 *
 * What goes: the project database (+ wal, shm), its blobs, offline packs and tile cache, the preview (database, blobs,
 * logins), and the control rows (project, memberships, participant logins, API tokens, sessions, join links, preview).
 * The key is retired for good (`retired_projects`): per-key caches in the running process would otherwise serve a new
 * project with the same key from the deleted one's closed database.
 */
import type { TemplateFile } from '@ueberblick/core';
import type { Principal } from '../../auth/contract';
import type { Db } from '../../db/driver';
import { errorResponse, jsonResponse } from '../shared/errors';
import { forgetPreview } from '../../preview/registry';
import { removeProjectFiles } from './files';
import type { EffectiveResult } from './project-file';

export interface DeleteProjectDeps {
  readonly control: Db;
  readonly dataDir: string;
  readonly clock: { now(): string };
  /** The runtime's: closes the preview's handle, removes its files and logins, bumps its generation. */
  dropPreview(projectId: string): void;
  /** Closes the project's open database handle (the runtime keeps it open after first use). */
  closeProject(key: string): void;
  /** Test seam; the default is `removeProjectFiles`, which the startup sweep shares (R1). */
  readonly removeFiles?: (dataDir: string, key: string) => void;
}

/** Control tables that carry a `project_id`; every one is emptied for the project. */
const PROJECT_TABLES = ['memberships', 'credentials', 'api_tokens', 'sessions', 'join_links'] as const;

/**
 * Removes the project. Order: handles closed, control rows removed (one transaction, so a crash never leaves a
 * half-listed project), then the files (a failure there leaves orphan files, never a project without data; the startup sweep finishes them).
 * Returns false for an unknown key.
 */
export function deleteProject(deps: DeleteProjectDeps, key: string): boolean {
  const { control, dataDir } = deps;
  const project = control.prepare<{ id: string }>('SELECT id FROM projects WHERE key = ?').get(key);
  if (!project) return false;
  deps.dropPreview(project.id);
  deps.closeProject(key);
  control.transaction(() => {
    for (const table of PROJECT_TABLES)
      control.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(project.id);
    forgetPreview(control, project.id);
    control.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
    control
      .prepare('INSERT OR IGNORE INTO retired_projects (key, retired_at) VALUES (?,?)')
      .run(key, deps.clock.now());
  });
  (deps.removeFiles ?? removeProjectFiles)(dataDir, key);
  return true;
}

/** What the confirm dialog lists; a zero is left out by the page (v3 filtered `n > 0`). */
export interface DeleteCounts {
  readonly types: number;
  readonly roles: number;
  readonly layers: number;
  readonly packs: number;
  readonly infoPages: number;
  readonly participants: number;
  readonly features: number;
}

const size = (o: object | undefined): number => (o === undefined ? 0 : Object.keys(o).length);

/** Counts from the project database and the effective project file (draft, else deployed). */
export function deleteCounts(db: Db, file: TemplateFile | null): DeleteCounts {
  const n = (sql: string): number => db.prepare<{ n: number }>(sql).get()?.n ?? 0;
  return {
    types: size(file?.types),
    roles: size(file?.roles),
    layers: size(file?.map?.layers),
    packs: size(file?.map?.packs),
    infoPages: size(file?.info_pages),
    participants: n('SELECT COUNT(*) AS n FROM participants'),
    features: n('SELECT COUNT(*) AS n FROM features'),
  };
}

export interface ProjectDeleteHandlerDeps {
  /**
   * Who may delete (A-037, provisional): a project membership, as v3 and A-008. 401 without a session, 403 for a
   * participant or a non-member, 404 for an unknown project. The one seam for a later owner role.
   */
  authorizeProjectDelete(
    principal: Principal | null,
    projectKey: string,
  ): { readonly projectKey: string } | Response;
  effectiveFile(projectKey: string): EffectiveResult;
  counts(projectKey: string, file: TemplateFile | null): DeleteCounts;
  remove(projectKey: string): boolean;
}

export interface ProjectDeleteCall {
  readonly request: Request;
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly principal: Principal | null;
}

export function createProjectDeleteHandlers(deps: ProjectDeleteHandlerDeps) {
  return {
    GET(call: ProjectDeleteCall): Response {
      const auth = deps.authorizeProjectDelete(call.principal, call.params['key'] ?? '');
      if (auth instanceof Response) return auth;
      const r = deps.effectiveFile(auth.projectKey);
      return jsonResponse(deps.counts(auth.projectKey, r.ok ? r.file : null), 200);
    },

    /** Body `{ "confirm": "<project key>" }`: the typed confirmation of v3's dialog, checked here too. */
    async DELETE(call: ProjectDeleteCall): Promise<Response> {
      const auth = deps.authorizeProjectDelete(call.principal, call.params['key'] ?? '');
      if (auth instanceof Response) return auth;
      const body: unknown = await call.request.json().catch(() => null);
      const confirm =
        typeof body === 'object' && body !== null ? (body as { confirm?: unknown }).confirm : undefined;
      if (confirm !== auth.projectKey)
        return errorResponse('invalid_body', 'Type the project key to confirm.');
      if (!deps.remove(auth.projectKey)) return errorResponse('not_found', 'Unknown project.');
      return new Response(null, { status: 204 });
    },
  };
}
