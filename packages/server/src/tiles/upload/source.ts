/**
 * What every input kind (ZIP, MBTiles) boils down to: the tile ids in ascending order and a way to read one tile. The
 * emitter (`emit.ts`) writes them as one clustered PMTiles archive with the existing writer (R1).
 */
import type { Compression } from 'pmtiles';
import type { Bounds, TileUploadFormat } from '@ueberblick/core';
import { TileUploadError } from './errors';
import { sniffRaster } from '../sniff';

export interface TileSource {
  readonly format: TileUploadFormat;
  readonly compression: Compression;
  /** Bounds the file declares; absent: the emitter derives them from the tiles of the highest zoom. */
  readonly bounds?: Bounds;
  readonly name?: string;
  /** PMTiles tile ids, ascending, unique. */
  readonly ids: Float64Array;
  read(tileId: number): Uint8Array | undefined | Promise<Uint8Array | undefined>;
  close(): void;
}

/** The format sniffed from raster bytes, as a registry key. */
export function rasterFormatOf(bytes: Uint8Array): 'png' | 'jpg' | 'webp' | undefined {
  const ext = sniffRaster(bytes)?.ext;
  return ext === 'png' || ext === 'jpg' || ext === 'webp' ? ext : undefined;
}

/** Throws unless the tile is an image of `format` (the admin chose it on upload). */
export function assertRaster(bytes: Uint8Array, format: TileUploadFormat, where: string): void {
  const found = rasterFormatOf(bytes);
  if (found === undefined)
    throw new TileUploadError('not_tiles', `${where} is not a PNG, JPEG or WebP image.`);
  if (found !== format)
    throw new TileUploadError('wrong_format', `${where} is ${found}, but ${format} was chosen.`);
}

export const yieldToRequests = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
