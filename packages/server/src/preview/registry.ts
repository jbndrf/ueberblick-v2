/**
 * The preview registry (WP-340, A-031): each project can have one preview, a second project database
 * `<dataDir>/preview-<project key>.db` served as the key `<project key>__vorschau`. It is registered in
 * control.db `previews`, never in `projects`, so only a caller that asks for previews by name ever sees one.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Clock } from '@ueberblick/core';
import type { Db } from '../db/driver';
import { assertProjectKey, openProjectDbFile } from '../db/open';

export const PREVIEW_SUFFIX = '__vorschau';

/** Server-local until the preview deploy (WP-341) needs it in core (A-031): `stale` = the draft did not compile. */
export const PREVIEW_STATUSES = ['ready', 'stale', 'dropped'] as const;
export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];

export interface Preview {
  readonly id: string;
  /** The served key, `<project key>__vorschau`. */
  readonly key: string;
  readonly projectId: string;
  readonly generation: number;
  readonly status: PreviewStatus;
}

export const previewKeyFor = (projectKey: string): string => `${projectKey}${PREVIEW_SUFFIX}`;
export const isPreviewKey = (key: string): boolean => key.endsWith(PREVIEW_SUFFIX);

/** `<dataDir>/preview-<project key>.db`: not matched by the backup's `project-*.db` pattern. */
export function previewDbPath(dataDir: string, projectKey: string): string {
  assertProjectKey(projectKey);
  return join(dataDir, `preview-${projectKey}.db`);
}

/** The blob directory of a served preview key (the runtime's `<dataDir>/blobs/<key>`). */
export const previewBlobDir = (dataDir: string, projectKey: string): string =>
  join(dataDir, 'blobs', previewKeyFor(projectKey));

interface Row {
  project_id: string;
  id: string;
  key: string;
  generation: number;
  status: string;
}
const toPreview = (r: Row): Preview => ({
  id: r.id,
  key: r.key,
  projectId: r.project_id,
  generation: r.generation,
  status: r.status as PreviewStatus,
});
const COLUMNS = 'project_id, id, key, generation, status';

function projectKeyOf(control: Db, projectId: string): string {
  const row = control.prepare<{ key: string }>('SELECT key FROM projects WHERE id = ?').get(projectId);
  if (!row) throw new Error(`unknown project: ${projectId}`);
  return row.key;
}

/**
 * Creates the preview of a project (its row and its migrated database) or returns the existing one. Idempotent. A
 * dropped preview comes back with its bumped generation.
 */
export function ensurePreview(
  control: Db,
  dataDir: string,
  projectId: string,
  clock: Clock,
): { readonly id: string; readonly key: string } {
  const projectKey = projectKeyOf(control, projectId);
  const existing = control
    .prepare<Row>(`SELECT ${COLUMNS} FROM previews WHERE project_id = ?`)
    .get(projectId);
  const id = existing?.id ?? randomUUID();
  const key = previewKeyFor(projectKey);
  mkdirSync(dataDir, { recursive: true });
  openProjectDbFile(previewDbPath(dataDir, projectKey)).close();
  if (!existing) {
    control
      .prepare(
        "INSERT INTO previews (project_id, id, key, generation, status, created_at) VALUES (?,?,?,1,'ready',?)",
      )
      .run(projectId, id, key, clock.now());
  } else if (existing.status === 'dropped') {
    control.prepare("UPDATE previews SET status = 'ready' WHERE project_id = ?").run(projectId);
  }
  return { id, key };
}

/**
 * Removes the preview's database file and blob directory, its sessions and (unless `keepLogins`) its login tokens, and
 * bumps `generation`. The row stays (status `dropped`) so the generation survives a re-creation. `keepLogins` is the
 * reset's: the tokens stay and the next sync moves them to the new generation's participants (WP-373, A-034). No row:
 * nothing to do. The caller closes any open handle first (the runtime's `dropPreview` does).
 */
export function dropPreview(
  control: Db,
  dataDir: string,
  projectId: string,
  opts: { readonly keepLogins?: boolean } = {},
): void {
  const row = control.prepare<Row>(`SELECT ${COLUMNS} FROM previews WHERE project_id = ?`).get(projectId);
  if (!row) return;
  const projectKey = projectKeyOf(control, projectId);
  const file = previewDbPath(dataDir, projectKey);
  for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) rmSync(f, { force: true });
  rmSync(previewBlobDir(dataDir, projectKey), { recursive: true, force: true });
  control.transaction(() => {
    control.prepare('DELETE FROM sessions WHERE project_id = ?').run(row.id);
    if (opts.keepLogins !== true) control.prepare('DELETE FROM credentials WHERE project_id = ?').run(row.id);
    control
      .prepare("UPDATE previews SET generation = generation + 1, status = 'dropped' WHERE project_id = ?")
      .run(projectId);
  });
}

/** The live preview served under `key` (`<project key>__vorschau`), or undefined (unknown or dropped). */
export function findPreview(control: Db, key: string): Preview | undefined {
  const row = control
    .prepare<Row>(`SELECT ${COLUMNS} FROM previews WHERE key = ? AND status != 'dropped'`)
    .get(key);
  return row ? toPreview(row) : undefined;
}

/** The preview of one project, whatever its status. */
export function previewOf(control: Db, projectId: string): Preview | undefined {
  const row = control.prepare<Row>(`SELECT ${COLUMNS} FROM previews WHERE project_id = ?`).get(projectId);
  return row ? toPreview(row) : undefined;
}

/** The served keys of the live previews: the timers loop's second list. */
export function previewKeys(control: Db): readonly string[] {
  return control
    .prepare<{ key: string }>("SELECT key FROM previews WHERE status != 'dropped' ORDER BY key")
    .all()
    .map((r) => r.key);
}

/** Removes the preview row for good (WP-388, project delete): call it after dropPreview. */
export function forgetPreview(control: Db, projectId: string): void {
  control.prepare('DELETE FROM previews WHERE project_id = ?').run(projectId);
}

/** Whether `id` is the id of a live preview: its logins' credentials are issued under it (WP-373). */
export function isLivePreviewId(control: Db, id: string): boolean {
  return (
    control.prepare("SELECT 1 AS x FROM previews WHERE id = ? AND status != 'dropped'").get(id) !== undefined
  );
}
