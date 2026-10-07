/**
 * The personal-data export's view of the server's one ZIP writer (`io/archive/zip-writer.ts`, R1): entries are stored
 * (method "stored"), streamed chunk by chunk and never buffered whole (docs/12). This layer adds only what the export
 * needs on top: safe, unique entry names and its own limits (65,535 entries, 4 GiB per archive, no ZIP64), refused
 * with `ZipLimitError`, and `ZipNameError` for a bad name.
 */
import { createZipWriter } from '../io/archive/zip-writer';

/** The archive would exceed what a non-ZIP64 archive holds: entries or bytes. */
export class ZipLimitError extends Error {}
/** An entry name that is duplicate, absolute or climbs out with `..`: a bug in the caller, not a size problem. */
export class ZipNameError extends Error {}

/** The format's own limits; injectable so tests need not write 4 GiB. */
export interface ZipLimits {
  readonly maxEntries?: number;
  readonly maxBytes?: number;
}

const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

export interface ZipWriter {
  /** Streams one entry; yields the archive bytes as they are produced. */
  add(name: string, source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): AsyncGenerator<Uint8Array>;
  /** Yields the central directory. Call once, after the last `add`. */
  finish(): Generator<Uint8Array>;
}

export function createZip(nowIso: string, limits: ZipLimits = {}): ZipWriter {
  const maxEntries = limits.maxEntries ?? MAX_ENTRIES;
  const maxBytes = limits.maxBytes ?? MAX_BYTES;
  const writer = createZipWriter(nowIso);
  const names = new Set<string>();
  let bytes = 0;
  const counted = (b: Uint8Array): Uint8Array => {
    bytes += b.length;
    if (bytes > maxBytes) throw new ZipLimitError(`archive larger than ${maxBytes} bytes`);
    return b;
  };
  return {
    async *add(name, source) {
      if (names.has(name) || name.startsWith('/') || name.split('/').includes('..'))
        throw new ZipNameError(`unsafe or duplicate entry name: ${name}`);
      if (names.size >= maxEntries) throw new ZipLimitError(`more than ${maxEntries} entries`);
      names.add(name);
      const data = (async function* () {
        yield* source;
      })();
      for await (const b of writer.add({ name, data, method: 'store' })) yield counted(b);
    },
    *finish() {
      for (const b of writer.finish()) yield counted(b);
    },
  };
}
