/** PMTiles input: the header and the root directory are validated, the file is then kept as it is (no re-encoding). */
import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { TileType } from 'pmtiles';
import { tileUploadMax, type TileUploadFormat } from '@ueberblick/core';
import { openArchive } from '../../packs/archive-read';
import type { FetchRange } from '../../packs/fetch';
import type { ArchiveResult } from './emit';
import { TileUploadError } from './errors';

const FORMATS: Readonly<Partial<Record<TileType, TileUploadFormat>>> = {
  [TileType.Png]: 'png',
  [TileType.Jpeg]: 'jpg',
  [TileType.Webp]: 'webp',
  [TileType.Mvt]: 'pbf',
};

async function fileRange(path: string): Promise<FetchRange> {
  const fh = await open(path, 'r');
  const range: FetchRange = async (_url, offset, length) => {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, offset);
    return buf.subarray(0, bytesRead);
  };
  return Object.assign(range, { close: () => fh.close() });
}

function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

/** Validates the PMTiles v3 archive at `path` and describes it. Throws `TileUploadError`. */
export async function describePmtiles(
  path: string,
  chosen: TileUploadFormat | undefined,
): Promise<ArchiveResult> {
  const size = statSync(path).size;
  const fetchRange = (await fileRange(path)) as FetchRange & { close(): Promise<void> };
  try {
    const archive = await openArchive(fetchRange, 'upload').catch(() => {
      throw new TileUploadError('corrupt', 'The file is not a valid PMTiles v3 archive.');
    });
    const h = archive.header;
    const format = FORMATS[h.tileType];
    if (h.specVersion !== 3) throw new TileUploadError('corrupt', 'Only PMTiles version 3 is supported.');
    if (format === undefined)
      throw new TileUploadError('not_tiles', 'The archive holds no PNG, JPEG, WebP or vector tiles.');
    if (chosen !== undefined && chosen !== format && format !== 'pbf')
      throw new TileUploadError('wrong_format', `The tiles are ${format}, but ${chosen} was chosen.`);
    const end = (offset: number, length: number | undefined): number => offset + (length ?? 0);
    if (
      end(h.rootDirectoryOffset, h.rootDirectoryLength) > size ||
      end(h.jsonMetadataOffset, h.jsonMetadataLength) > size ||
      end(h.leafDirectoryOffset, h.leafDirectoryLength) > size ||
      end(h.tileDataOffset, h.tileDataLength) > size
    )
      throw new TileUploadError(
        'corrupt',
        'The archive is cut off: its sections reach past the end of the file.',
      );
    if (h.numAddressedTiles === 0) throw new TileUploadError('not_tiles', 'The archive holds no tiles.');
    const max = tileUploadMax('tiles');
    if (h.numAddressedTiles > max)
      throw new TileUploadError('too_many_tiles', `The archive holds more than ${max} tiles.`);
    if (!(h.minLon < h.maxLon && h.minLat < h.maxLat))
      throw new TileUploadError('corrupt', 'The archive has no valid bounds.');
    return {
      format,
      bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat],
      minZoom: h.minZoom,
      maxZoom: h.maxZoom,
      tiles: h.numAddressedTiles,
      bytes: size,
      sha256: await sha256(path),
    };
  } finally {
    await fetchRange.close();
  }
}
