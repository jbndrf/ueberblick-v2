// A tiny PMTiles v3 archive builder for the pack specs and the bench. Tests only. Directories and tiles are stored
// uncompressed (compression "none"), one root directory, so the `pmtiles` reader needs no decompression.
import { zxyToTileId } from 'pmtiles';
import type { PackTileType } from '@ueberblick/core/registry/admin';

export interface FixtureTile {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  readonly data: Uint8Array;
}

const varint = (n: number, out: number[]): void => {
  let v = n;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
};

interface Row {
  readonly id: number;
  readonly run: number;
  readonly length: number;
  readonly offset: number;
}

/** One directory: entries sorted by id; an offset equal to the previous end is stored as 0. */
function directory(rows: readonly Row[]): number[] {
  const out: number[] = [];
  varint(rows.length, out);
  let prev = 0;
  for (const r of rows) {
    varint(r.id - prev, out);
    prev = r.id;
  }
  for (const r of rows) varint(r.run, out);
  for (const r of rows) varint(r.length, out);
  rows.forEach((r, i) => {
    const before = rows[i - 1];
    varint(before !== undefined && r.offset === before.offset + before.length ? 0 : r.offset + 1, out);
  });
  return out;
}

/** Entries per leaf directory; the root directory must fit in the first 16 KB with the header (PMTiles spec). */
const LEAF = 1000;

/** PMTiles v3 bytes holding `tiles`. `tileType` 2 is png, 1 is mvt. Compression "none"; leaf directories above `LEAF` tiles. */
export function buildPmtiles(tiles: readonly FixtureTile[], tileType = 2): Uint8Array {
  const sorted = tiles.map((t) => ({ ...t, id: zxyToTileId(t.z, t.x, t.y) })).sort((a, b) => a.id - b.id);
  let at = 0;
  const rows: Row[] = sorted.map((t) => {
    const row = { id: t.id, run: 1, length: t.data.length, offset: at };
    at += t.data.length;
    return row;
  });
  const dataLen = at;
  let root: number[];
  let leaves: number[] = [];
  if (rows.length <= LEAF) root = directory(rows);
  else {
    const entries: Row[] = [];
    for (let i = 0; i < rows.length; i += LEAF) {
      const leaf = directory(rows.slice(i, i + LEAF));
      entries.push({ id: rows[i]?.id ?? 0, run: 0, length: leaf.length, offset: leaves.length });
      leaves = leaves.concat(leaf);
    }
    root = directory(entries);
  }
  const meta = new TextEncoder().encode('{}');
  const rootOffset = 127;
  const metaOffset = rootOffset + root.length;
  const leafOffset = metaOffset + meta.length;
  const dataOffset = leafOffset + leaves.length;
  const out = new Uint8Array(dataOffset + dataLen);
  const v = new DataView(out.buffer);
  out.set(new TextEncoder().encode('PMTiles'), 0);
  out[7] = 3;
  const u64 = (pos: number, n: number): void => v.setBigUint64(pos, BigInt(n), true);
  u64(8, rootOffset);
  u64(16, root.length);
  u64(24, metaOffset);
  u64(32, meta.length);
  u64(40, leafOffset);
  u64(48, leaves.length);
  u64(56, dataOffset);
  u64(64, dataLen);
  u64(72, sorted.length);
  u64(80, sorted.length);
  u64(88, sorted.length);
  out[96] = 1; // clustered
  out[97] = 1; // internal compression: none
  out[98] = 1; // tile compression: none
  out[99] = tileType;
  out[100] = Math.min(...sorted.map((t) => t.z));
  out[101] = Math.max(...sorted.map((t) => t.z));
  out.set(root, rootOffset);
  out.set(meta, metaOffset);
  out.set(leaves, leafOffset);
  let o = dataOffset;
  for (const t of sorted) {
    out.set(t.data, o);
    o += t.data.length;
  }
  return out;
}

/** A pack file over those bytes, as the protocol reads it. */
export function fixtureFile(
  id: string,
  layer: string,
  bytes: Uint8Array,
  maxZoom: number,
  tileType: PackTileType = 'raster',
): {
  id: string;
  layer: string;
  tileType: PackTileType;
  maxZoom: number;
  read(o: number, l: number): Promise<Uint8Array>;
} {
  return { id, layer, tileType, maxZoom, read: async (o, l) => bytes.slice(o, o + l) };
}
