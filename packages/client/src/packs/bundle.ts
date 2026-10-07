// The offline pack file (WP-668, decision B-017, v3's `.ubpack`): ONE file holding a pack's layer archives.
//
//   "UBPK" | u32le manifestLength | manifest JSON (utf8) | layer 0 | layer 1 | ...
//
// The manifest is the A-032 `PackManifestEntry` plus each layer's offset (from the end of the manifest) and length.
// The whole format lives here. Export builds a lazy Blob (a header plus the stored layer files, never read into memory);
// import reads a byte stream, writes each layer to the store and checks its sha256 on the way (incremental).
import { decodePackManifest } from '@ueberblick/core/sync';
import type { PackLayerEntry, PackManifestEntry, PackWriter } from './contract';
import type { PackRefusal } from './refusals';
import { createSha256 } from './sha256';

export const PACK_MAGIC = 'UBPK';
export const PACK_FILE_EXTENSION = 'ubpack';
/** A manifest is a few KB; this keeps a wrong file from making the device buffer megabytes. */
const MAX_MANIFEST_BYTES = 1 << 20;

/** A pack file the device refuses. `kind` is what the user is told (translated); `message` is a detail for logs only. */
export class PackFileError extends Error {
  constructor(
    readonly kind: PackRefusal,
    detail: string,
  ) {
    super(detail);
  }
}

interface FileLayer {
  readonly layer: string;
  readonly offset: number;
  readonly length: number;
}
interface FileHeader {
  readonly version: 1;
  readonly pack: PackManifestEntry;
  readonly layers: readonly FileLayer[];
}

const encoder = new TextEncoder();

/** A name that is safe as a directory or file name inside the pack store. */
export const safeName = (s: string): boolean => /^[A-Za-z0-9._-]+$/.test(s) && s !== '.' && s !== '..';

/** Magic, length prefix and manifest JSON for `pack` (its layer files follow in order). */
export function encodePackHeader(pack: PackManifestEntry): Uint8Array<ArrayBuffer> {
  let offset = 0;
  const layers = pack.layers.map((l) => {
    const entry = { layer: l.layer, offset, length: l.bytes };
    offset += l.bytes;
    return entry;
  });
  const { key, label, hash, bounds, min_zoom, max_zoom, bytes, built_at } = pack;
  const entry: PackManifestEntry = {
    key,
    label,
    hash,
    bounds,
    min_zoom,
    max_zoom,
    bytes,
    built_at,
    layers: pack.layers.map((l) => ({
      layer: l.layer,
      tile_type: l.tile_type,
      url: l.url,
      bytes: l.bytes,
      sha256: l.sha256,
      max_zoom: l.max_zoom,
      tiles: l.tiles,
    })),
  };
  const json = encoder.encode(JSON.stringify({ version: 1, pack: entry, layers } satisfies FileHeader));
  const out = new Uint8Array(new ArrayBuffer(8 + json.length));
  out.set(encoder.encode(PACK_MAGIC), 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  return out;
}

/** The file as a Blob over the stored layer files: lazy, so a large pack is never read into memory. */
export const packFileBlob = (pack: PackManifestEntry, layerFiles: readonly Blob[]): Blob =>
  new Blob([encodePackHeader(pack), ...layerFiles]);

/** The suggested file name: the pack's label without characters a file system refuses. */
export const packFileName = (label: string): string =>
  `${label.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'pack'}.${PACK_FILE_EXTENSION}`;

/** Pulls exact byte counts out of a chunk stream; buffers at most one source chunk. */
class Puller {
  private rest: Uint8Array = new Uint8Array(0);
  private readonly it: AsyncIterator<Uint8Array>;
  constructor(source: AsyncIterable<Uint8Array>) {
    this.it = source[Symbol.asyncIterator]();
  }
  private async more(): Promise<boolean> {
    for (;;) {
      const r = await this.it.next();
      if (r.done === true) return false;
      if (r.value.length > 0) {
        this.rest = r.value;
        return true;
      }
    }
  }
  /** Exactly `n` bytes, or fewer when the source ends. Only for the small header. */
  async take(n: number): Promise<Uint8Array> {
    const out = new Uint8Array(n);
    let got = 0;
    while (got < n) {
      if (this.rest.length === 0 && !(await this.more())) break;
      const k = Math.min(n - got, this.rest.length);
      out.set(this.rest.subarray(0, k), got);
      this.rest = this.rest.subarray(k);
      got += k;
    }
    return out.subarray(0, got);
  }
  /** The next `n` bytes as pieces no larger than a source chunk; throws `truncated` when the source ends early. */
  async *pieces(n: number): AsyncGenerator<Uint8Array> {
    let left = n;
    while (left > 0) {
      if (this.rest.length === 0 && !(await this.more()))
        throw new PackFileError('truncated', 'truncated pack file');
      const k = Math.min(left, this.rest.length);
      yield this.rest.subarray(0, k);
      this.rest = this.rest.subarray(k);
      left -= k;
    }
  }
  async atEnd(): Promise<boolean> {
    return this.rest.length === 0 && !(await this.more());
  }
}

async function readHeader(pull: Puller): Promise<FileHeader> {
  const prefix = await pull.take(8);
  if (prefix.length < 8 || new TextDecoder().decode(prefix.subarray(0, 4)) !== PACK_MAGIC)
    throw new PackFileError('not_a_pack', 'not an offline pack file');
  const len = new DataView(prefix.buffer, prefix.byteOffset, 8).getUint32(4, true);
  if (len > MAX_MANIFEST_BYTES) throw new PackFileError('not_a_pack', 'manifest too large');
  const json = await pull.take(len);
  if (json.length < len) throw new PackFileError('truncated', 'truncated manifest');
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(json));
  } catch {
    throw new PackFileError('not_a_pack', 'manifest is not JSON');
  }
  const o = (raw ?? {}) as { version?: unknown; pack?: unknown; layers?: unknown };
  if (o.version !== 1)
    throw new PackFileError('unsupported_version', `pack file version ${String(o.version)}`);
  const dec = decodePackManifest({ packs: [o.pack] });
  if (!dec.ok || dec.manifest.packs[0] === undefined)
    throw new PackFileError('bad_manifest', dec.ok ? 'no pack' : dec.reason);
  const pack = dec.manifest.packs[0];
  if (!safeName(pack.hash) || !pack.layers.every((l) => safeName(l.layer)))
    throw new PackFileError('unsafe_name', 'unsafe hash or layer name');
  const layers = Array.isArray(o.layers) ? (o.layers as FileLayer[]) : [];
  let at = 0;
  const ok =
    layers.length === pack.layers.length &&
    pack.layers.every((l, i) => {
      const f = layers[i];
      const fits = f?.layer === l.layer && f.offset === at && f.length === l.bytes;
      at += l.bytes;
      return fits;
    });
  if (!ok) throw new PackFileError('bad_manifest', 'layer table does not match');
  return { version: 1, pack, layers };
}

/** What the reader needs from the device. */
export interface PackFileSink {
  /** The manifest entry, once read. False stops without reading the layers (the device holds it already). Throw to refuse. */
  accept(pack: PackManifestEntry): boolean;
  /** Where layer bytes go; the reader closes it. */
  open(layer: PackLayerEntry): Promise<PackWriter>;
}

/**
 * Reads a pack file from `source`: header, then each layer streamed into `sink` and verified against its sha256.
 * Throws `PackFileError` (with its kind) on a file that is not a pack, is cut short, has extra bytes or fails its hash;
 * the caller removes what was written. Returns the entry, and whether the layers were read (`accept` said yes).
 */
export async function readPackFile(
  source: AsyncIterable<Uint8Array>,
  sink: PackFileSink,
  onProgress?: (done: number, total: number) => void,
): Promise<{ readonly pack: PackManifestEntry; readonly read: boolean }> {
  const pull = new Puller(source);
  const { pack } = await readHeader(pull);
  if (!sink.accept(pack)) return { pack, read: false };
  const total = pack.layers.reduce((n, l) => n + l.bytes, 0);
  let done = 0;
  onProgress?.(0, total);
  for (const l of pack.layers) {
    const w = await sink.open(l);
    const hash = createSha256();
    try {
      for await (const piece of pull.pieces(l.bytes)) {
        hash.update(piece);
        await w.write(piece);
        done += piece.length;
        onProgress?.(done, total);
      }
    } finally {
      await w.close();
    }
    if (hash.hex() !== l.sha256) throw new PackFileError('sha256_mismatch', `layer ${l.layer}`);
  }
  if (!(await pull.atEnd())) throw new PackFileError('trailing_bytes', 'bytes after the last layer');
  return { pack, read: true };
}

/** A web stream as chunks (`for await` over a ReadableStream is not in every browser). */
export async function* streamChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) return;
      yield r.value;
    }
  } finally {
    reader.releaseLock();
  }
}
