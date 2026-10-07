/**
 * The one streaming ZIP writer of the server (WP-384; the personal-data export uses it too, R1). It streams entries with
 * a data descriptor (sizes and CRC follow the data) and writes the central directory at the end, so no entry is held
 * whole in memory (R14). No Zip64: a file or entry of 4 GiB or more is refused with `ZipTooLarge`. The CRC-32 is
 * `node:zlib`'s.
 */
import { constants, crc32, createDeflateRaw } from 'node:zlib';

export type Chunks = AsyncIterable<Uint8Array>;
export interface ZipEntry {
  readonly name: string;
  readonly data: Chunks;
  /** `store` for data that is compressed already (photos); default `deflate`. */
  readonly method?: 'store' | 'deflate';
}

export class ZipTooLarge extends Error {
  constructor() {
    super('The archive is too large for the ZIP format used here (4 GiB).');
    this.name = 'ZipTooLarge';
  }
}
const LIMIT = 0xffffffff;
const SIG_LOCAL = 0x04034b50;
const SIG_DESCRIPTOR = 0x08074b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const FLAGS = 0x0808; // bit 3: data descriptor, bit 11: UTF-8 names
/** 1 January 2020 00:00 (DOS time and date) unless a time is given: entry times carry no meaning, so the archive is reproducible. */
const DEFAULT_TIME = { time: 0, date: ((2020 - 1980) << 9) | (1 << 5) | 1 };

function dos(iso: string): { time: number; date: number } {
  const d = new Date(iso);
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

const u16 = (v: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
};
const u32 = (v: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0);
  return b;
};
export const buf = (c: Uint8Array): Buffer => Buffer.from(c.buffer, c.byteOffset, c.byteLength);

interface Written {
  readonly name: Buffer;
  readonly method: number;
  readonly crc: number;
  readonly csize: number;
  readonly usize: number;
  readonly offset: number;
}

async function* deflated(source: Chunks, sink: { csize: number }): AsyncGenerator<Uint8Array> {
  const d = createDeflateRaw({ level: constants.Z_DEFAULT_COMPRESSION });
  const feed = (async () => {
    try {
      for await (const c of source) if (!d.write(c)) await new Promise((r) => d.once('drain', r));
      d.end();
    } catch (e) {
      d.destroy(e instanceof Error ? e : new Error(String(e)));
    }
  })();
  for await (const c of d) {
    sink.csize += (c as Buffer).byteLength;
    yield c as Buffer;
  }
  await feed;
}

export interface ZipWriter {
  /** Streams one entry; yields the archive bytes as they are produced. */
  add(entry: ZipEntry): AsyncGenerator<Uint8Array>;
  /** Yields the central directory. Call once, after the last `add`. */
  finish(): Generator<Uint8Array>;
}

/** An incremental writer: `add` per entry, then `finish`. `nowIso` stamps the entries (default: a fixed date). */
export function createZipWriter(nowIso?: string): ZipWriter {
  const { time, date } = nowIso === undefined ? DEFAULT_TIME : dos(nowIso);
  let offset = 0;
  const written: Written[] = [];
  const emit = (b: Buffer): Buffer => {
    offset += b.byteLength;
    return b;
  };
  return {
    async *add(entry) {
      const name = Buffer.from(entry.name, 'utf8');
      const method = entry.method === 'store' ? 0 : 8;
      const start = offset;
      if (start > LIMIT) throw new ZipTooLarge();
      yield emit(
        Buffer.concat([
          u32(SIG_LOCAL),
          u16(20),
          u16(FLAGS),
          u16(method),
          u16(time),
          u16(date),
          u32(0),
          u32(0),
          u32(0),
          u16(name.byteLength),
          u16(0),
          name,
        ]),
      );
      let crc = 0;
      let usize = 0;
      const counted = (async function* () {
        for await (const c of entry.data) {
          crc = crc32(c, crc);
          usize += c.byteLength;
          yield c;
        }
      })();
      const sink = { csize: 0 };
      if (method === 0) {
        for await (const c of counted) {
          sink.csize += c.byteLength;
          yield emit(buf(c));
        }
      } else for await (const c of deflated(counted, sink)) yield emit(buf(c));
      if (sink.csize > LIMIT || usize > LIMIT) throw new ZipTooLarge();
      yield emit(Buffer.concat([u32(SIG_DESCRIPTOR), u32(crc), u32(sink.csize), u32(usize)]));
      written.push({ name, method, crc, csize: sink.csize, usize, offset: start });
    },
    *finish() {
      const cdStart = offset;
      for (const w of written)
        yield emit(
          Buffer.concat([
            u32(SIG_CENTRAL),
            u16(20),
            u16(20),
            u16(FLAGS),
            u16(w.method),
            u16(time),
            u16(date),
            u32(w.crc),
            u32(w.csize),
            u32(w.usize),
            u16(w.name.byteLength),
            u16(0),
            u16(0),
            u16(0),
            u16(0),
            u32(0),
            u32(w.offset),
            w.name,
          ]),
        );
      const cdSize = offset - cdStart;
      if (offset > LIMIT || written.length > 0xffff) throw new ZipTooLarge();
      yield emit(
        Buffer.concat([
          u32(SIG_END),
          u16(0),
          u16(0),
          u16(written.length),
          u16(written.length),
          u32(cdSize),
          u32(cdStart),
          u16(0),
        ]),
      );
    },
  };
}

/** The bytes of a ZIP archive holding `entries`, produced as they are consumed. */
export async function* zipStream(
  entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>,
): AsyncGenerator<Uint8Array> {
  const zip = createZipWriter();
  for await (const entry of entries) yield* zip.add(entry);
  yield* zip.finish();
}
