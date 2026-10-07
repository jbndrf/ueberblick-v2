/**
 * A tiny PMTiles v3 archive for the pack journeys (WP-843): a raster pyramid from zoom 0 to `maxZoom` over the world,
 * every tile the same 8 bytes (the directory lets all tile ids share one blob), no compression. Written by hand
 * because the server's archive writer is internal; the pack builder reads it with the real `pmtiles` reader.
 */
const HEADER = 127;
const NONE = 1;
const PNG = 2;

function varint(out: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

/** One directory whose entries are the tile ids 0..n-1, each one tile of `length` bytes at offset 0. */
function directory(n: number, length: number): Uint8Array {
  const out: number[] = [];
  varint(out, n);
  for (let i = 0; i < n; i++) varint(out, i === 0 ? 0 : 1); // tile id deltas
  for (let i = 0; i < n; i++) varint(out, 1); // run lengths
  for (let i = 0; i < n; i++) varint(out, length);
  for (let i = 0; i < n; i++) varint(out, 1); // offset 0, written as offset + 1 (not "right after the last")
  return Uint8Array.from(out);
}

export function fixturePmtiles(maxZoom: number): Uint8Array {
  const tileCount = (4 ** (maxZoom + 1) - 1) / 3;
  const tile = new Uint8Array(Buffer.from('fixture!'));
  const root = directory(tileCount, tile.length);
  const metadata = new Uint8Array(Buffer.from(JSON.stringify({ name: 'fixture' })));
  const rootOffset = HEADER;
  const metaOffset = rootOffset + root.length;
  const dataOffset = metaOffset + metadata.length;
  const buf = Buffer.alloc(dataOffset + tile.length);
  buf.write('PMTiles', 0, 'latin1');
  buf.writeUInt8(3, 7);
  const u64 = (at: number, v: number): void => void buf.writeBigUInt64LE(BigInt(v), at);
  u64(8, rootOffset);
  u64(16, root.length);
  u64(24, metaOffset);
  u64(32, metadata.length);
  u64(40, 0); // no leaf directories
  u64(48, 0);
  u64(56, dataOffset);
  u64(64, tile.length);
  u64(72, tileCount);
  u64(80, tileCount);
  u64(88, 1);
  buf.writeUInt8(0, 96); // not clustered
  buf.writeUInt8(NONE, 97);
  buf.writeUInt8(NONE, 98);
  buf.writeUInt8(PNG, 99);
  buf.writeUInt8(0, 100);
  buf.writeUInt8(maxZoom, 101);
  buf.writeInt32LE(-1800000000, 102);
  buf.writeInt32LE(-850000000, 106);
  buf.writeInt32LE(1800000000, 110);
  buf.writeInt32LE(850000000, 114);
  buf.writeUInt8(0, 118);
  buf.writeInt32LE(0, 119);
  buf.writeInt32LE(0, 123);
  buf.set(root, rootOffset);
  buf.set(metadata, metaOffset);
  buf.set(tile, dataOffset);
  return new Uint8Array(buf);
}
