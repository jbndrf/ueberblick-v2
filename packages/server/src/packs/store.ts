/**
 * The `pack_builds` table (migration 19) and the packs of a config: which (pack, layer) files a deployed config needs,
 * their hashes and the queue of builds. All SQL of the pack job is here.
 */
import {
  estimatePack,
  packTileType,
  sourceMaxZoom,
  type MapLayer,
  type PackBuildState,
  type TemplateFile,
} from '@ueberblick/core';
import type { Db } from '../db/driver';
import { packHash, type PackDef } from './hash';

export interface BuildRow {
  readonly pack_hash: string;
  readonly pack_key: string;
  readonly layer: string;
  readonly state: PackBuildState;
  readonly tiles_done: number;
  readonly tiles_total: number;
  readonly bytes: number;
  readonly sha256: string | null;
  readonly max_zoom: number | null;
  readonly tiles: number | null;
  readonly error: string | null;
  readonly updated_at: string;
}

/** One pack of a config with its hash and the layers it holds. */
export interface PackTarget {
  readonly key: string;
  readonly def: PackDef;
  readonly hash: string;
  readonly layers: readonly { readonly layer: string; readonly def: MapLayer }[];
}

/** The packs of a config, with hashes. Layers the config does not declare are left out (the checker refuses them). */
export function packTargets(file: TemplateFile): PackTarget[] {
  const layers = file.map?.layers ?? {};
  return Object.entries(file.map?.packs ?? {}).map(([key, def]) => ({
    key,
    def,
    hash: packHash(def, layers),
    layers: def.layers.flatMap((layer) => {
      const found = layers[layer];
      return found === undefined ? [] : [{ layer, def: found }];
    }),
  }));
}

/** The estimate of one layer of a pack: the same arithmetic as the admin dialog and the checker (R1). */
export function layerEstimate(
  pack: PackDef,
  layer: MapLayer,
): { tiles: number; bytes: number; maxZoom: number } {
  const est = estimatePack(pack.bounds, pack.min_zoom, pack.max_zoom, [
    { key: 'l', tileType: packTileType(layer), sourceMaxZoom: sourceMaxZoom(layer) },
  ]).layers[0];
  if (est === undefined) throw new Error('the estimate of a one-layer pack has no layer');
  return est;
}

/**
 * Queues every (pack, layer) of the config that is not built. A new hash gets a `queued` row; a `failed` row is
 * queued again; `queued`, `building` and `ready` rows stay as they are, so a redeploy with the same hash enqueues
 * nothing. Returns how many rows were queued.
 */
export function enqueuePacks(db: Db, file: TemplateFile, now: string): number {
  const find = db.prepare<{ state: PackBuildState }>(
    'SELECT state FROM pack_builds WHERE pack_hash = ? AND layer = ?',
  );
  const insert = db.prepare(
    `INSERT INTO pack_builds (pack_hash, pack_key, layer, state, tiles_total, updated_at) VALUES (?, ?, ?, 'queued', ?, ?)`,
  );
  const requeue = db.prepare(
    `UPDATE pack_builds SET state = 'queued', tiles_done = 0, bytes = 0, error = NULL, updated_at = ? WHERE pack_hash = ? AND layer = ?`,
  );
  return db.transaction(() => {
    let queued = 0;
    for (const t of packTargets(file))
      for (const l of t.layers) {
        const row = find.get(t.hash, l.layer);
        if (row === undefined) insert.run(t.hash, t.key, l.layer, layerEstimate(t.def, l.def).tiles, now);
        else if (row.state === 'failed') requeue.run(now, t.hash, l.layer);
        else continue;
        queued++;
      }
    return queued;
  });
}

const COLUMNS =
  'pack_hash, pack_key, layer, state, tiles_done, tiles_total, bytes, sha256, max_zoom, tiles, error, updated_at';

/** The rows of the given hashes (one query per hash: a project has a handful of packs). */
export function rowsOf(db: Db, hashes: readonly string[]): BuildRow[] {
  const stmt = db.prepare<BuildRow>(`SELECT ${COLUMNS} FROM pack_builds WHERE pack_hash = ? ORDER BY layer`);
  return hashes.flatMap((h) => stmt.all(h));
}

/** The next row to build: one that was `building` when the process stopped, else the oldest queued. */
export function claimNext(db: Db, now: string): BuildRow | undefined {
  return db.transaction(() => {
    const row = db
      .prepare<BuildRow>(
        `SELECT ${COLUMNS} FROM pack_builds WHERE state IN ('building', 'queued')
         ORDER BY state = 'building' DESC, updated_at, pack_hash, layer LIMIT 1`,
      )
      .get();
    if (row === undefined) return undefined;
    db.prepare(
      "UPDATE pack_builds SET state = 'building', updated_at = ? WHERE pack_hash = ? AND layer = ?",
    ).run(now, row.pack_hash, row.layer);
    return { ...row, state: 'building' as const };
  });
}

export function saveProgress(
  db: Db,
  row: { pack_hash: string; layer: string },
  p: { tilesDone: number; tilesTotal: number; bytes: number },
  now: string,
): void {
  db.prepare(
    'UPDATE pack_builds SET tiles_done = ?, tiles_total = ?, bytes = ?, updated_at = ? WHERE pack_hash = ? AND layer = ?',
  ).run(p.tilesDone, p.tilesTotal, p.bytes, now, row.pack_hash, row.layer);
}

export function markReady(
  db: Db,
  row: { pack_hash: string; layer: string },
  r: { bytes: number; sha256: string; maxZoom: number; tiles: number },
  now: string,
): void {
  db.prepare(
    `UPDATE pack_builds SET state = 'ready', bytes = ?, sha256 = ?, max_zoom = ?, tiles = ?, tiles_done = tiles_total,
       error = NULL, updated_at = ? WHERE pack_hash = ? AND layer = ?`,
  ).run(r.bytes, r.sha256, r.maxZoom, r.tiles, now, row.pack_hash, row.layer);
}

export function markFailed(
  db: Db,
  row: { pack_hash: string; layer: string },
  reason: string,
  now: string,
): void {
  db.prepare(
    "UPDATE pack_builds SET state = 'failed', error = ?, updated_at = ? WHERE pack_hash = ? AND layer = ?",
  ).run(reason, now, row.pack_hash, row.layer);
}

/** Queues the failed layers of one pack hash again; returns how many. */
export function requeueFailed(db: Db, hash: string, now: string): number {
  return db
    .prepare(
      `UPDATE pack_builds SET state = 'queued', tiles_done = 0, bytes = 0, error = NULL, updated_at = ?
       WHERE pack_hash = ? AND state = 'failed'`,
    )
    .run(now, hash).changes;
}

export function deleteRow(db: Db, row: { pack_hash: string; layer: string }): void {
  db.prepare('DELETE FROM pack_builds WHERE pack_hash = ? AND layer = ?').run(row.pack_hash, row.layer);
}

/** Every hash that has rows. */
export function storedHashes(db: Db): string[] {
  return db
    .prepare<{ pack_hash: string }>('SELECT DISTINCT pack_hash FROM pack_builds')
    .all()
    .map((r) => r.pack_hash);
}

export function deleteHash(db: Db, hash: string): void {
  db.prepare('DELETE FROM pack_builds WHERE pack_hash = ?').run(hash);
}
