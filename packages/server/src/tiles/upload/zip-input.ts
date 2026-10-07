/**
 * ZIP input: tiles laid out as `z/x/y.<png|jpg|webp>`, optionally inside one wrapper folder (v3's layout). The reader is
 * the one of the project archive (`io/archive/zip.ts`, R1): central directory, streamed inflate, and its zip-bomb limits
 * (an entry that declares or inflates past `TILE_UPLOAD_MAX.tile_bytes`, all entries past `inflated_bytes`).
 */
import { Compression, zxyToTileId } from 'pmtiles';
import { tileUploadMax, type TileUploadFormat } from '@ueberblick/core';
import { ArchiveLimitError, openZip, ZipCorrupt } from '../../io/archive/zip';
import { TileUploadError } from './errors';
import type { TileSource } from './source';
import { yieldToRequests } from './source';

const TILE_NAME = /^(?:[^/]+\/)?(\d{1,2})\/(\d{1,8})\/(\d{1,8})\.(png|jpe?g|webp)$/i;
const FORMAT_OF_EXT: Readonly<Record<string, TileUploadFormat>> = {
  png: 'png',
  jpg: 'jpg',
  jpeg: 'jpg',
  webp: 'webp',
};

/** A limit or a damaged file of the reader, as the typed refusal of an upload. */
export function zipRefusal(e: unknown): TileUploadError | undefined {
  if (e instanceof TileUploadError) return e;
  if (e instanceof ArchiveLimitError)
    return new TileUploadError('zip_bomb', `The ZIP is refused: ${e.message}`);
  if (e instanceof ZipCorrupt) return new TileUploadError('corrupt', e.message);
  return undefined;
}

export async function openZipTiles(path: string, chosen: TileUploadFormat | undefined): Promise<TileSource> {
  let zip;
  try {
    zip = await openZip(path, {
      maxEntryBytes: tileUploadMax('tile_bytes'),
      maxTotalBytes: tileUploadMax('inflated_bytes'),
      maxTextBytes: 1,
    });
  } catch (e) {
    throw zipRefusal(e) ?? e;
  }
  const byId = new Map<number, string>();
  const formats = new Set<TileUploadFormat>();
  const max = tileUploadMax('tiles');
  for (const entry of zip.entries) {
    const m = TILE_NAME.exec(entry.name);
    if (m === null) continue;
    const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (z > 26 || x >= 2 ** z || y >= 2 ** z)
      throw new TileUploadError('not_tiles', `The tile ${z}/${x}/${y} is outside the pyramid.`);
    if (byId.size >= max)
      throw new TileUploadError('too_many_tiles', `The archive holds more than ${max} tiles.`);
    byId.set(zxyToTileId(z, x, y), entry.name);
    formats.add(FORMAT_OF_EXT[(m[4] as string).toLowerCase()] as TileUploadFormat);
    if (byId.size % 5000 === 0) await yieldToRequests();
  }
  if (byId.size === 0)
    throw new TileUploadError('not_tiles', 'The ZIP holds no tiles named z/x/y.png, .jpg or .webp.');
  if (formats.size > 1)
    throw new TileUploadError('wrong_format', 'The ZIP mixes tile formats; use one format.');
  const [found] = [...formats] as [TileUploadFormat];
  if (chosen !== undefined && chosen !== found)
    throw new TileUploadError('wrong_format', `The tiles are ${found}, but ${chosen} was chosen.`);
  return {
    format: found,
    compression: Compression.None,
    ids: Float64Array.from(byId.keys()).sort(),
    async read(id) {
      const name = byId.get(id);
      if (name === undefined) return undefined;
      const parts: Uint8Array[] = [];
      try {
        for await (const c of zip.open(name)) parts.push(c);
      } catch (e) {
        throw zipRefusal(e) ?? e;
      }
      return Buffer.concat(parts);
    },
    close: () => undefined,
  };
}
