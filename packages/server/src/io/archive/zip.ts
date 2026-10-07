/**
 * The ZIP reader (WP-384), on `node:zlib` only: no dependency, and it holds no whole entry in memory (R14). The writer is
 * `zip-writer.ts`. The reader finds entries through the central directory of a file on disk and streams
 * one entry at a time, checking its CRC. No Zip64: a file or entry of 4 GiB or more is refused with `ZipTooLarge`.
 */
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { crc32, createInflateRaw } from 'node:zlib';
import { buf, type Chunks } from './zip-writer';

export {
  ZipTooLarge,
  zipStream,
  createZipWriter,
  type Chunks,
  type ZipEntry,
  type ZipWriter,
} from './zip-writer';
/** Why a limit refused an entry (`ARCHIVE_PROBLEM_CODES` in `manifest.ts` names the same keys). */
export const ARCHIVE_LIMIT_CODES = {
  entry_too_large: 'entry_too_large',
  archive_too_large: 'archive_too_large',
  entry_over_declared: 'entry_over_declared',
  text_too_large: 'text_too_large',
} as const;
export type ArchiveLimitCode = keyof typeof ARCHIVE_LIMIT_CODES;

/** A zip-bomb defence refused the archive: it is a typed refusal, never a crash (`code` names the case). */
export class ArchiveLimitError extends Error {
  constructor(
    readonly code: ArchiveLimitCode,
    readonly entry: string,
    message: string,
  ) {
    super(message);
    this.name = 'ArchiveLimitError';
  }
}

/** The numbers every read is held to (`ARCHIVE_LIMITS`): the inflated size is checked while it streams, never trusted. */
export interface ArchiveZipLimits {
  /** One entry's inflated bytes. */
  readonly maxEntryBytes: number;
  /** All entries' inflated bytes together, over every read of this file. */
  readonly maxTotalBytes: number;
  /** An entry read as text (`text()`): held in memory, so far smaller. */
  readonly maxTextBytes: number;
}

export class ZipCorrupt extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipCorrupt';
  }
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;

export interface ZipFileEntry {
  readonly name: string;
  readonly size: number;
}
export interface ZipFile {
  readonly entries: readonly ZipFileEntry[];
  has(name: string): boolean;
  /**
   * The entry's bytes, inflated and CRC-checked as they are read. It throws `ArchiveLimitError` as soon as the inflated
   * bytes pass the entry's declared size (the header may lie), an entry limit or the archive's total.
   */
  open(name: string): Chunks;
  text(name: string): Promise<string>;
}

interface Central extends ZipFileEntry {
  readonly method: number;
  readonly crc: number;
  readonly csize: number;
  readonly offset: number;
}

async function readCentral(path: string): Promise<Central[]> {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 0xffff + 22);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let at = -1;
    for (let i = tailLen - 22; i >= 0; i--)
      if (tail.readUInt32LE(i) === SIG_END) {
        at = i;
        break;
      }
    if (at < 0) throw new ZipCorrupt('The file is not a ZIP archive.');
    const count = tail.readUInt16LE(at + 10);
    const cdSize = tail.readUInt32LE(at + 12);
    const cdStart = tail.readUInt32LE(at + 16);
    if (cdStart + cdSize > size) throw new ZipCorrupt('The ZIP directory is damaged.');
    const dir = Buffer.alloc(cdSize);
    await fh.read(dir, 0, cdSize, cdStart);
    const central: Central[] = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > dir.byteLength || dir.readUInt32LE(p) !== SIG_CENTRAL)
        throw new ZipCorrupt('The ZIP directory is damaged.');
      const nameLen = dir.readUInt16LE(p + 28);
      central.push({
        name: dir.toString('utf8', p + 46, p + 46 + nameLen),
        method: dir.readUInt16LE(p + 10),
        crc: dir.readUInt32LE(p + 16),
        csize: dir.readUInt32LE(p + 20),
        size: dir.readUInt32LE(p + 24),
        offset: dir.readUInt32LE(p + 42),
      });
      p += 46 + nameLen + dir.readUInt16LE(p + 30) + dir.readUInt16LE(p + 32);
    }
    return central;
  } finally {
    await fh.close();
  }
}

async function dataStart(path: string, e: Central): Promise<number> {
  const h = await open(path, 'r');
  try {
    const head = Buffer.alloc(30);
    await h.read(head, 0, 30, e.offset);
    if (head.readUInt32LE(0) !== SIG_LOCAL) throw new ZipCorrupt(`${e.name} is damaged.`);
    return e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  } finally {
    await h.close();
  }
}

/** Reads the central directory of the ZIP at `path`. Throws `ZipCorrupt` when the file is not a ZIP, `ArchiveLimitError` when it declares more than `limits` allow. */
export async function openZip(path: string, limits: ArchiveZipLimits): Promise<ZipFile> {
  const central = await readCentral(path);
  const byName = new Map(central.map((e) => [e.name, e]));
  const declared = central.reduce((n, e) => n + e.size, 0);
  const tooBig = central.find((e) => e.size > limits.maxEntryBytes);
  if (tooBig !== undefined)
    throw new ArchiveLimitError(
      'entry_too_large',
      tooBig.name,
      `${tooBig.name} declares ${tooBig.size} bytes.`,
    );
  if (declared > limits.maxTotalBytes)
    throw new ArchiveLimitError('archive_too_large', '', `The entries declare ${declared} bytes.`);
  let total = 0;

  async function* read(name: string): Chunks {
    const e = byName.get(name);
    if (e === undefined) throw new ZipCorrupt(`The archive has no ${name}.`);
    if (e.method !== 0 && e.method !== 8) throw new ZipCorrupt(`${name} uses an unsupported compression.`);
    if (e.csize === 0) {
      if (e.size !== 0 || e.crc !== 0) throw new ZipCorrupt(`${name} is damaged.`);
      return;
    }
    const from = await dataStart(path, e);
    const raw = createReadStream(path, { start: from, end: from + e.csize - 1 });
    const inflater = e.method === 8 ? createInflateRaw() : undefined;
    const source: AsyncIterable<Buffer> = inflater === undefined ? raw : raw.pipe(inflater);
    let crc = 0;
    let n = 0;
    try {
      for await (const c of source) {
        n += c.byteLength;
        total += c.byteLength;
        // the declared size may lie: the bytes are counted as they come, before they are handed on
        if (n > e.size)
          throw new ArchiveLimitError(
            'entry_over_declared',
            name,
            `${name} inflates past its declared ${e.size} bytes.`,
          );
        if (total > limits.maxTotalBytes)
          throw new ArchiveLimitError('archive_too_large', name, 'The archive inflates past its limit.');
        crc = crc32(c, crc);
        yield c;
      }
    } catch (err) {
      if (err instanceof ArchiveLimitError) throw err;
      throw new ZipCorrupt(`${name} is damaged.`);
    } finally {
      raw.destroy();
      inflater?.destroy();
    }
    if (crc !== e.crc || n !== e.size) throw new ZipCorrupt(`${name} is damaged (checksum).`);
  }

  return {
    entries: central.map((e) => ({ name: e.name, size: e.size })),
    has: (name) => byName.has(name),
    open: read,
    async text(name) {
      const e = byName.get(name);
      if (e !== undefined && e.size > limits.maxTextBytes)
        throw new ArchiveLimitError(
          'text_too_large',
          name,
          `${name} is ${e.size} bytes, a text entry may have ${limits.maxTextBytes}.`,
        );
      const parts: Buffer[] = [];
      for await (const c of read(name)) parts.push(buf(c));
      return Buffer.concat(parts).toString('utf8');
    },
  };
}
