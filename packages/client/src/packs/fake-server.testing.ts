// A fake manifest and a fake Range download server for the pack specs and the bench. Tests only.
import type {
  PackDownload,
  PackLayerEntry,
  PackManifest,
  PackManifestEntry,
  PackTransport,
} from './contract';
import { createSha256 } from './sha256';

export const sha256Hex = (bytes: Uint8Array): string => {
  const h = createSha256();
  h.update(bytes);
  return h.hex();
};

/** `n` bytes that depend on `seed` (so two layers differ). */
export const bytesOf = (n: number, seed: number): Uint8Array =>
  Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed * 7 + (i >> 8)) & 255);

export interface FakeLayer {
  readonly layer: string;
  readonly bytes: Uint8Array;
  readonly max_zoom?: number;
  readonly tiles?: number;
  /** Lie about the digest, to provoke a mismatch. */
  readonly sha256?: string;
}

export function fakePack(key: string, hash: string, layers: readonly FakeLayer[]): PackManifestEntry {
  const entries: PackLayerEntry[] = layers.map((l) => ({
    layer: l.layer,
    tile_type: 'raster',
    url: `/api/p/demo/packs/${hash}/${l.layer}.pmtiles`,
    bytes: l.bytes.length,
    sha256: l.sha256 ?? sha256Hex(l.bytes),
    max_zoom: l.max_zoom ?? 17,
    tiles: l.tiles ?? 10,
  }));
  return {
    key,
    label: key,
    hash,
    bounds: [7, 50, 8, 51],
    min_zoom: 12,
    max_zoom: 17,
    layers: entries,
    bytes: entries.reduce((n, e) => n + e.bytes, 0),
    built_at: '2026-10-01T00:00:00Z',
  };
}

export interface FakeServer extends PackTransport {
  manifestNow: PackManifest;
  /** The bytes by URL. */
  readonly files: Map<string, Uint8Array>;
  /** Every download request as `[url, from]`. */
  readonly requests: [string, number][];
  /** Cut the next download after this many bytes with an error (a dropped connection). */
  cutAfter: number | undefined;
  /** Answer 200 and the whole file whatever the Range says. */
  ignoreRange: boolean;
  offline: boolean;
}

export function fakeServer(
  packs: readonly PackManifestEntry[],
  contents: Record<string, Uint8Array>,
): FakeServer {
  const files = new Map(Object.entries(contents));
  const s: FakeServer = {
    manifestNow: { packs },
    files,
    requests: [],
    cutAfter: undefined,
    ignoreRange: false,
    offline: false,
    async manifest() {
      if (s.offline) throw new Error('offline');
      return s.manifestNow;
    },
    async download(url, from): Promise<PackDownload> {
      if (s.offline) throw new Error('offline');
      s.requests.push([url, from]);
      const found = files.get(url);
      if (found === undefined) throw new Error('404');
      const all: Uint8Array = found;
      const start = s.ignoreRange ? 0 : from;
      const cut = s.cutAfter;
      s.cutAfter = undefined;
      async function* chunks(): AsyncGenerator<Uint8Array> {
        let sent = 0;
        for (let o = start; o < all.length; o += 64) {
          if (cut !== undefined && sent >= cut) throw new Error('connection lost');
          const part = all.subarray(o, Math.min(o + 64, all.length));
          sent += part.length;
          yield part;
        }
      }
      return { partial: !s.ignoreRange && from > 0, chunks: chunks() };
    },
  };
  return s;
}
