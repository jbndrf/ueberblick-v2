/**
 * Writes a `TileSource` as one clustered PMTiles archive with the existing writer (`packs/archive-write.ts`, R1): the
 * tiles are copied in tile-id order into a spool file in batches (yielding to other requests between them), then the
 * writer puts the head parts and the spool together.
 */
import { closeSync, openSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { tileIdToZxy, TileType } from 'pmtiles';
import { tileUploadMax, type Bounds, type TileUploadFormat } from '@ueberblick/core';
import { writeArchive, type WrittenTile } from '../../packs/archive-write';
import { TileUploadError } from './errors';
import { assertRaster, yieldToRequests, type TileSource } from './source';

export interface ArchiveResult {
  readonly format: TileUploadFormat;
  readonly bounds: Bounds;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly tiles: number;
  readonly bytes: number;
  readonly sha256: string;
}

export interface Progress {
  (done: number, total: number): void;
}

const TILE_TYPES: Readonly<Record<TileUploadFormat, TileType>> = {
  png: TileType.Png,
  jpg: TileType.Jpeg,
  webp: TileType.Webp,
  pbf: TileType.Mvt,
};

const lon = (x: number, z: number): number => (x / 2 ** z) * 360 - 180;
const lat = (y: number, z: number): number =>
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

/** The bounds of the tiles at the highest zoom. */
export function tilesBounds(ids: Float64Array): Bounds {
  const top = tileIdToZxy(ids[ids.length - 1] as number)[0];
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = ids.length - 1; i >= 0; i--) {
    const [z, x, y] = tileIdToZxy(ids[i] as number);
    if (z !== top) break;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return [lon(x0, top), lat(y1 + 1, top), lon(x1 + 1, top), lat(y0, top)];
}

export async function emitArchive(
  source: TileSource,
  workDir: string,
  outPath: string,
  progress: Progress,
): Promise<ArchiveResult> {
  const spool = join(workDir, 'spool');
  const fd = openSync(spool, 'w');
  const tiles: WrittenTile[] = [];
  const maxTile = tileUploadMax('tile_bytes');
  const batch = tileUploadMax('batch');
  let offset = 0;
  try {
    const total = source.ids.length;
    for (let i = 0; i < total; i++) {
      const id = source.ids[i] as number;
      const data = await source.read(id);
      if (data === undefined) throw new TileUploadError('corrupt', 'A tile listed in the file is missing.');
      if (data.length > maxTile)
        throw new TileUploadError('tile_too_large', `A tile is larger than ${maxTile} bytes.`);
      if (source.format !== 'pbf') assertRaster(data, source.format, 'A tile');
      writeSync(fd, data);
      tiles.push({ tileId: id, offset, length: data.length });
      offset += data.length;
      if ((i + 1) % batch === 0) {
        progress(i + 1, total);
        await yieldToRequests();
      }
    }
    progress(total, total);
  } finally {
    closeSync(fd);
  }
  const bounds = source.bounds ?? tilesBounds(source.ids);
  const first = tileIdToZxy(source.ids[0] as number)[0];
  const last = tileIdToZxy(source.ids[source.ids.length - 1] as number)[0];
  const written = await writeArchive(outPath, spool, offset, tiles, {
    bounds,
    tileType: TILE_TYPES[source.format],
    tileCompression: source.compression,
    metadata: Buffer.from(JSON.stringify({ name: source.name ?? '', format: source.format })),
  });
  rmSync(spool, { force: true });
  return {
    format: source.format,
    bounds,
    minZoom: first,
    maxZoom: last,
    tiles: tiles.length,
    bytes: written.bytes,
    sha256: written.sha256,
  };
}
