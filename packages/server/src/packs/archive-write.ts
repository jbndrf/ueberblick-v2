/**
 * A small PMTiles v3 writer: a clustered archive whose tile data is already in tile-id order in a spool file.
 * Layout: header (127 bytes), root directory, metadata, leaf directories, tile data. Directories are gzipped.
 */
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { Compression, tileIdToZxy, type TileType } from 'pmtiles';
import type { Bounds } from '@ueberblick/core';

const HEADER_BYTES = 127;
/** The root directory and the header must fit the first 16 KiB read of a reader (spec). */
const ROOT_LIMIT = 16384 - HEADER_BYTES;

/** One stored tile: ids ascend, offsets are relative to the start of the tile data. */
export interface WrittenTile {
  readonly tileId: number;
  readonly offset: number;
  readonly length: number;
}

interface DirEntry extends WrittenTile {
  readonly runLength: number;
}

function varint(out: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

/** The directory format of the spec: count, id deltas, run lengths, lengths, offsets (0 = right after the previous). */
export function serializeDirectory(entries: readonly DirEntry[]): Uint8Array {
  const out: number[] = [];
  varint(out, entries.length);
  let last = 0;
  for (const e of entries) {
    varint(out, e.tileId - last);
    last = e.tileId;
  }
  for (const e of entries) varint(out, e.runLength);
  for (const e of entries) varint(out, e.length);
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    varint(out, prev !== undefined && e.offset === prev.offset + prev.length ? 0 : e.offset + 1);
  });
  return Uint8Array.from(out);
}

const packDir = (entries: readonly DirEntry[]): Uint8Array => gzipSync(serializeDirectory(entries));

export interface Directories {
  readonly root: Uint8Array;
  readonly leaves: Uint8Array;
}

/** One root directory when it fits, else leaf directories of growing size until the root of pointers fits. */
export function buildDirectories(tiles: readonly WrittenTile[]): Directories {
  const all: DirEntry[] = tiles.map((t) => ({ ...t, runLength: 1 }));
  const whole = packDir(all);
  if (whole.length <= ROOT_LIMIT) return { root: whole, leaves: new Uint8Array(0) };
  for (let leafSize = 4096; ; leafSize = Math.ceil(leafSize * 1.2)) {
    const pointers: DirEntry[] = [];
    const chunks: Uint8Array[] = [];
    let at = 0;
    for (let i = 0; i < all.length; i += leafSize) {
      const chunk = packDir(all.slice(i, i + leafSize));
      pointers.push({ tileId: (all[i] as DirEntry).tileId, offset: at, length: chunk.length, runLength: 0 });
      chunks.push(chunk);
      at += chunk.length;
    }
    const root = packDir(pointers);
    if (root.length <= ROOT_LIMIT || pointers.length === 1) return { root, leaves: Buffer.concat(chunks) };
  }
}

export interface ArchiveInfo {
  readonly bounds: Bounds;
  readonly tileType: TileType;
  readonly tileCompression: Compression;
  /** The metadata JSON, uncompressed. */
  readonly metadata: Uint8Array;
}

function headerBytes(
  info: ArchiveInfo,
  tiles: readonly WrittenTile[],
  at: {
    root: number;
    rootLen: number;
    meta: number;
    metaLen: number;
    leaf: number;
    leafLen: number;
    data: number;
    dataLen: number;
  },
): Uint8Array {
  const buf = new Uint8Array(HEADER_BYTES);
  const v = new DataView(buf.buffer);
  buf.set([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73, 3]);
  const u64 = (o: number, n: number): void => v.setBigUint64(o, BigInt(n), true);
  u64(8, at.root);
  u64(16, at.rootLen);
  u64(24, at.meta);
  u64(32, at.metaLen);
  u64(40, at.leaf);
  u64(48, at.leafLen);
  u64(56, at.data);
  u64(64, at.dataLen);
  u64(72, tiles.length);
  u64(80, tiles.length);
  u64(88, tiles.length);
  v.setUint8(96, 1);
  v.setUint8(97, Compression.Gzip);
  v.setUint8(98, info.tileCompression);
  v.setUint8(99, info.tileType);
  const first = tiles[0] as WrittenTile;
  const last = tiles[tiles.length - 1] as WrittenTile;
  v.setUint8(100, tileIdToZxy(first.tileId)[0]);
  v.setUint8(101, tileIdToZxy(last.tileId)[0]);
  const [w, s, e, n] = info.bounds;
  const e7 = (deg: number): number => Math.round(deg * 1e7);
  v.setInt32(102, e7(w), true);
  v.setInt32(106, e7(s), true);
  v.setInt32(110, e7(e), true);
  v.setInt32(114, e7(n), true);
  v.setUint8(118, tileIdToZxy(first.tileId)[0]);
  v.setInt32(119, e7((w + e) / 2), true);
  v.setInt32(123, e7((s + n) / 2), true);
  return buf;
}

export interface WriteResult {
  readonly bytes: number;
  readonly sha256: string;
}

/**
 * Writes the archive to `outPath`: the head parts, then `spoolPath` (the tile data, `dataLength` bytes) streamed.
 * The metadata is stored gzipped.
 */
export async function writeArchive(
  outPath: string,
  spoolPath: string,
  dataLength: number,
  tiles: readonly WrittenTile[],
  info: ArchiveInfo,
): Promise<WriteResult> {
  if (tiles.length === 0) throw new Error('an archive needs at least one tile');
  const { root, leaves } = buildDirectories(tiles);
  const meta = gzipSync(info.metadata);
  const rootAt = HEADER_BYTES;
  const metaAt = rootAt + root.length;
  const leafAt = metaAt + meta.length;
  const dataAt = leafAt + leaves.length;
  const head = headerBytes(info, tiles, {
    root: rootAt,
    rootLen: root.length,
    meta: metaAt,
    metaLen: meta.length,
    leaf: leafAt,
    leafLen: leaves.length,
    data: dataAt,
    dataLen: dataLength,
  });
  const out = createWriteStream(outPath);
  out.on('error', () => undefined);
  const hash = createHash('sha256');
  let bytes = 0;
  const put = async (chunk: Uint8Array): Promise<void> => {
    hash.update(chunk);
    bytes += chunk.length;
    if (!out.write(chunk)) await once(out, 'drain');
  };
  try {
    for (const part of [head, root, meta, leaves]) await put(part);
    for await (const chunk of createReadStream(spoolPath, { end: Math.max(0, dataLength - 1) }))
      await put(chunk as Uint8Array);
    out.end();
    await once(out, 'finish');
  } catch (e) {
    out.destroy();
    throw e;
  }
  return { bytes, sha256: hash.digest('hex') };
}
