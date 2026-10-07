import { crc32 } from 'node:zlib';

/** A minimal ZIP reader for tests: central directory, stored entries, CRC checked with `node:zlib` (not the writer's own). */
export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (eocd >= 0 && v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('no end of central directory');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('bad central header');
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const offset = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = v.getUint16(offset + 26, true);
    const lExtraLen = v.getUint16(offset + 28, true);
    const start = offset + 30 + lNameLen + lExtraLen;
    const data = bytes.subarray(start, start + size);
    if (crc32(data) !== crc) throw new Error(`crc mismatch for ${name}`);
    out.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export async function collectBytes(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const c of source) parts.push(c);
  return Buffer.concat(parts);
}
