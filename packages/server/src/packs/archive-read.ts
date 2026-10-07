/**
 * Reads a remote PMTiles v3 archive by range (header, directories, tile bytes) to find where tiles are. The `pmtiles`
 * package only hands out decoded tiles; the build needs the offsets, to copy the stored bytes without decoding them
 * and to merge neighbouring tiles into one request.
 */
import { gunzipSync } from 'node:zlib';
import { bytesToHeader, Compression, findTile, readVarint, type Entry, type Header } from 'pmtiles';
import type { FetchRange } from './fetch';

const HEADER_BYTES = 127;
const FIRST_READ = 16384;
const MAX_DEPTH = 4;
const CACHED_DIRECTORIES = 64;

/** Where one tile's stored bytes are in the source file. */
export interface TileLocation {
  readonly offset: number;
  readonly length: number;
}

export interface SourceArchive {
  readonly header: Header;
  /** The metadata JSON as stored (compressed as `header.internalCompression` says). */
  readonly metadata: Uint8Array;
  /** The location of a tile, or `undefined` when the archive has none under that id. */
  locate(tileId: number): Promise<TileLocation | undefined>;
}

export function decompress(bytes: Uint8Array, compression: Compression): Uint8Array {
  if (compression === Compression.None || compression === Compression.Unknown) return bytes;
  if (compression === Compression.Gzip) return gunzipSync(bytes);
  throw new Error(
    `the archive uses a compression the build does not read (${Compression[compression] ?? compression})`,
  );
}

/** The directory format of the spec (§ Directory serialization): counts, id deltas, run lengths, lengths, offsets. */
export function deserializeDirectory(bytes: Uint8Array): Entry[] {
  const p = { buf: bytes, pos: 0 };
  const n = readVarint(p);
  const entries: Entry[] = [];
  let id = 0;
  for (let i = 0; i < n; i++) {
    id += readVarint(p);
    entries.push({ tileId: id, offset: 0, length: 0, runLength: 1 });
  }
  for (const e of entries) e.runLength = readVarint(p);
  for (const e of entries) e.length = readVarint(p);
  entries.forEach((e, i) => {
    const o = readVarint(p);
    const prev = entries[i - 1];
    e.offset = o === 0 && prev !== undefined ? prev.offset + prev.length : o - 1;
  });
  return entries;
}

export async function openArchive(fetchRange: FetchRange, url: string): Promise<SourceArchive> {
  const first = await fetchRange(url, 0, FIRST_READ);
  if (first.byteLength < HEADER_BYTES || first[0] !== 0x50 || first[1] !== 0x4d)
    throw new Error('the source is not a PMTiles archive');
  const header = bytesToHeader(first.slice(0, HEADER_BYTES).buffer);
  const part = async (offset: number, length: number): Promise<Uint8Array> =>
    offset + length <= first.byteLength
      ? first.subarray(offset, offset + length)
      : fetchRange(url, offset, length);
  const directories = new Map<number, Entry[]>();
  const directory = async (offset: number, length: number): Promise<Entry[]> => {
    const hit = directories.get(offset);
    if (hit !== undefined) return hit;
    const entries = deserializeDirectory(decompress(await part(offset, length), header.internalCompression));
    if (directories.size >= CACHED_DIRECTORIES) directories.clear();
    directories.set(offset, entries);
    return entries;
  };
  const metadata = await part(header.jsonMetadataOffset, header.jsonMetadataLength);
  return {
    header,
    metadata: metadata.slice(),
    async locate(tileId) {
      let offset = header.rootDirectoryOffset;
      let length = header.rootDirectoryLength;
      for (let depth = 0; depth <= MAX_DEPTH; depth++) {
        const found = findTile(await directory(offset, length), tileId);
        if (found === null) return undefined;
        if (found.runLength > 0)
          return { offset: header.tileDataOffset + found.offset, length: found.length };
        offset = header.leafDirectoryOffset + found.offset;
        length = found.length;
      }
      throw new Error('the archive nests directories deeper than the spec allows');
    },
  };
}
