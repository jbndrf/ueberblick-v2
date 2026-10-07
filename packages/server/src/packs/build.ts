/**
 * Builds one (pack, layer) file from a `pmtiles` source (A-032 item 2), resumably.
 *
 * The tiles of the pack are listed in tile-id order. A spool directory next to the result holds the tile bytes copied so far
 * (`.part`) and one 24-byte record per tile (`.idx`). After each batch the database row stores how far the list
 * is done and how many bytes the spool holds, so a restart cuts both files back to that point and carries on: no tile
 * twice, none missing. The finished archive is written to a temp name and renamed, so a half file is never served.
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { layerMaxZoom, sourceMaxZoom, type MapLayer } from '@ueberblick/core';
import type { Db } from '../db/driver';
import { writeArchive, type WrittenTile } from './archive-write';
import type { Guard } from '../tiles/guard';
import type { FetchRange } from './fetch';
import type { PackDef } from './hash';
import { openReader, type PackTiles } from './readers';
import { markReady, saveProgress, type BuildRow } from './store';
import { packTileIds } from './tile-range';

/** Tiles per batch: the unit of persisted progress. */
const BATCH = 512;
const RECORD = 24;

export class BuildAborted extends Error {
  constructor() {
    super('the build was stopped');
  }
}

export interface BuildDeps {
  readonly db: Db;
  readonly now: () => string;
  readonly fetchRange: FetchRange;
  /** Tiles of `xyz` and `preset` layers, through the tile service (A-033): the build warms the proxy's cache. */
  readonly tiles?: PackTiles;
  /** The SSRF guard of the tile proxy (A-033): shared, so a layer URL is judged the same way everywhere. */
  readonly guard?: Guard;
  /** `<blobs>/packs/<project>`: the files go to `<dir>/<pack_hash>/<layer>.pmtiles`. */
  readonly dir: string;
  readonly batch?: number;
  readonly signal?: AbortSignal;
}

export const layerFile = (dir: string, hash: string, layer: string): string =>
  join(dir, hash, `${layer}.pmtiles`);

function encode(t: WrittenTile): Buffer {
  const b = Buffer.alloc(RECORD);
  b.writeDoubleLE(t.tileId, 0);
  b.writeDoubleLE(t.offset, 8);
  b.writeUInt32LE(t.length, 16);
  return b;
}

function decode(b: Buffer): WrittenTile[] {
  const out: WrittenTile[] = [];
  for (let i = 0; i + RECORD <= b.length; i += RECORD)
    out.push({ tileId: b.readDoubleLE(i), offset: b.readDoubleLE(i + 8), length: b.readUInt32LE(i + 16) });
  return out;
}

interface Spool {
  readonly part: string;
  readonly idx: string;
  tiles: WrittenTile[];
  bytes: number;
}

/** Cuts the spool back to what the row says is committed; anything that does not add up starts over. */
function restoreSpool(spool: Spool, row: BuildRow, ids: readonly number[]): number {
  const fresh = (): number => {
    writeFileSync(spool.part, '');
    writeFileSync(spool.idx, '');
    spool.tiles = [];
    spool.bytes = 0;
    return 0;
  };
  if (!existsSync(spool.part) || !existsSync(spool.idx) || row.tiles_done === 0) return fresh();
  const kept = decode(readFileSync(spool.idx)).filter((t) => t.offset + t.length <= row.bytes);
  const end =
    kept.length === 0
      ? 0
      : (kept[kept.length - 1] as WrittenTile).offset + (kept[kept.length - 1] as WrittenTile).length;
  const next = ids[row.tiles_done];
  const lastId = kept.length === 0 ? -1 : (kept[kept.length - 1] as WrittenTile).tileId;
  if (end !== row.bytes || row.tiles_done > ids.length || (next !== undefined && lastId >= next))
    return fresh();
  truncateSync(spool.part, row.bytes);
  truncateSync(spool.idx, kept.length * RECORD);
  spool.tiles = kept;
  spool.bytes = row.bytes;
  return row.tiles_done;
}

/** The first bytes of the spool: enough to tell the format of its first tile. */
function firstBytes(path: string): Uint8Array {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(16);
    return buf.subarray(0, readSync(fd, buf, 0, 16, 0));
  } finally {
    closeSync(fd);
  }
}

/** Builds the file of one layer; resolves when the row is `ready`. Throws on failure (the caller marks it `failed`). */
export async function buildLayer(
  deps: BuildDeps,
  row: BuildRow,
  pack: PackDef,
  layer: MapLayer,
): Promise<void> {
  const { db, now, fetchRange } = deps;
  const dir = join(deps.dir, row.pack_hash);
  mkdirSync(dir, { recursive: true });
  const reader = await openReader({ fetchRange, tiles: deps.tiles, guard: deps.guard }, layer);
  const maxZoom = Math.min(layerMaxZoom(pack.max_zoom, sourceMaxZoom(layer)), reader.zoomCap ?? Infinity);
  const ids = packTileIds(pack.bounds, pack.min_zoom, maxZoom);
  reader.check(ids.length);
  const spool: Spool = {
    part: join(dir, `${row.layer}.part`),
    idx: join(dir, `${row.layer}.idx`),
    tiles: [],
    bytes: 0,
  };
  let done = restoreSpool(spool, row, ids);
  saveProgress(db, row, { tilesDone: done, tilesTotal: ids.length, bytes: spool.bytes }, now());
  const size = deps.batch ?? BATCH;
  while (done < ids.length) {
    if (deps.signal?.aborted) throw new BuildAborted();
    const slice = ids.slice(done, done + size);
    const bytes = await reader.read(slice);
    const chunks: Buffer[] = [];
    const records: Buffer[] = [];
    for (const tileId of slice) {
      const data = bytes.get(tileId);
      if (data === undefined) continue;
      const tile = { tileId, offset: spool.bytes, length: data.length };
      chunks.push(Buffer.from(data.buffer, data.byteOffset, data.length));
      records.push(encode(tile));
      spool.tiles.push(tile);
      spool.bytes += data.length;
    }
    appendFileSync(spool.part, Buffer.concat(chunks));
    appendFileSync(spool.idx, Buffer.concat(records));
    done += slice.length;
    saveProgress(db, row, { tilesDone: done, tilesTotal: ids.length, bytes: spool.bytes }, now());
  }
  if (spool.tiles.length === 0) throw new Error('the source has no tiles in the pack area and zoom range');
  const target = layerFile(deps.dir, row.pack_hash, row.layer);
  const tmp = `${target}.tmp`;
  const info = reader.info(firstBytes(spool.part));
  const written = await writeArchive(tmp, spool.part, spool.bytes, spool.tiles, {
    bounds: pack.bounds,
    ...info,
  });
  renameSync(tmp, target);
  rmSync(spool.part, { force: true });
  rmSync(spool.idx, { force: true });
  markReady(
    db,
    row,
    { bytes: written.bytes, sha256: written.sha256, maxZoom, tiles: spool.tiles.length },
    now(),
  );
}
