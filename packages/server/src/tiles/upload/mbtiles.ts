/** MBTiles input (SQLite, rows are TMS: y is flipped). Two passes: the keys to find the order, then the tile blobs. */
import { closeSync, openSync, readSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Compression, tileIdToZxy, zxyToTileId } from 'pmtiles';
import { tileUploadMax, type Bounds, type TileUploadFormat } from '@ueberblick/core';
import { TileUploadError } from './errors';
import { assertRaster, yieldToRequests, type TileSource } from './source';

const SQLITE_MAGIC = 'SQLite format 3\0';
const FORMATS: Readonly<Record<string, TileUploadFormat>> = {
  png: 'png',
  jpg: 'jpg',
  jpeg: 'jpg',
  webp: 'webp',
  pbf: 'pbf',
  mvt: 'pbf',
};

interface KeyRow {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

function bounded(text: string | undefined): Bounds | undefined {
  const parts = text?.split(',').map((v) => Number(v.trim()));
  if (parts?.length !== 4 || parts.some((v) => !Number.isFinite(v))) return undefined;
  const [w = 0, s = 0, e = 0, n = 0] = parts;
  return w < e && s < n && w >= -180 && e <= 180 && s >= -90 && n <= 90 ? [w, s, e, n] : undefined;
}

const isGzip = (b: Uint8Array): boolean => b[0] === 0x1f && b[1] === 0x8b;

function assertSqlite(path: string): void {
  const head = Buffer.alloc(16);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, head, 0, 16, 0);
  } finally {
    closeSync(fd);
  }
  if (head.toString('latin1') !== SQLITE_MAGIC)
    throw new TileUploadError('corrupt', 'The file is not an MBTiles (SQLite) database.');
}

async function tileIds(db: Database.Database): Promise<Float64Array> {
  const found: number[] = [];
  const max = tileUploadMax('tiles');
  for (const k of db
    .prepare('SELECT zoom_level z, tile_column x, tile_row y FROM tiles')
    .iterate() as Iterable<KeyRow>) {
    if (k.z < 0 || k.z > 26 || k.x < 0 || k.y < 0 || k.x >= 2 ** k.z || k.y >= 2 ** k.z)
      throw new TileUploadError('not_tiles', `The tile ${k.z}/${k.x}/${k.y} is outside the pyramid.`);
    if (found.length >= max)
      throw new TileUploadError('too_many_tiles', `The archive holds more than ${max} tiles.`);
    found.push(zxyToTileId(k.z, k.x, 2 ** k.z - 1 - k.y));
    if (found.length % 1000 === 0) await yieldToRequests();
  }
  if (found.length === 0) throw new TileUploadError('not_tiles', 'The MBTiles holds no tiles.');
  return Float64Array.from(found).sort();
}

export async function openMbtiles(path: string, chosen: TileUploadFormat | undefined): Promise<TileSource> {
  assertSqlite(path);
  let db: Database.Database;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
  } catch {
    throw new TileUploadError('corrupt', 'The MBTiles database cannot be opened.');
  }
  try {
    const meta = new Map<string, string>();
    let ids: Float64Array;
    try {
      for (const r of db.prepare('SELECT name, value FROM metadata').iterate() as Iterable<{
        name: string;
        value: string;
      }>)
        meta.set(r.name, String(r.value));
      ids = await tileIds(db);
    } catch (e) {
      if (e instanceof TileUploadError) throw e;
      throw new TileUploadError('corrupt', 'The MBTiles is damaged or has no tiles table.');
    }
    const byKey = db.prepare(
      'SELECT tile_data d FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?',
    );
    const read = (id: number): Uint8Array | undefined => {
      const [z, x, y] = tileIdToZxy(id);
      return (byKey.get(z, x, 2 ** z - 1 - y) as { d: Buffer } | undefined)?.d;
    };
    const first = read(ids[0] as number);
    if (first === undefined) throw new TileUploadError('corrupt', 'The MBTiles has an unreadable tile.');
    const gz = isGzip(first);
    const format: TileUploadFormat = gz
      ? 'pbf'
      : (FORMATS[(meta.get('format') ?? '').toLowerCase()] ?? 'png');
    if (format !== 'pbf') assertRaster(first, chosen ?? format, 'The first tile');
    else if (chosen !== undefined && chosen !== 'pbf')
      throw new TileUploadError('wrong_format', `The tiles are vector tiles, but ${chosen} was chosen.`);
    const bounds = bounded(meta.get('bounds'));
    const name = meta.get('name');
    return {
      format: format === 'pbf' ? 'pbf' : (chosen ?? format),
      compression: gz ? Compression.Gzip : Compression.None,
      ...(bounds === undefined ? {} : { bounds }),
      ...(name === undefined ? {} : { name }),
      ids,
      read,
      close: () => db.close(),
    };
  } catch (e) {
    db.close();
    throw e;
  }
}
