// Offline packs on the device (WP-662, contract A-032): the manifest the server lists, the device store port, the
// progress signal and the index of what is on the device. No UI here; the Offline tab (WP-650) binds the stores.

import type { PackState, PackTileType } from '@ueberblick/core/registry/admin';
import type { PackLayerEntry, PackManifest, PackManifestEntry } from '@ueberblick/core/sync';

export type { PackState, PackTileType };
// The manifest types live in core (WP-650): the server's builder types against the same definition (R1).
export type { PackLayerEntry, PackManifest, PackManifestEntry };

/** What a pack's progress shows. `bytes_done` counts layers that were kept and bytes already on the device. */
export interface PackProgress {
  readonly state: PackState;
  readonly bytes_done: number;
  readonly bytes_total: number;
  /** Why the pack is `failed`. */
  readonly reason?: string;
}

/** A layer file on the device. `path` is where its bytes are; a kept layer of a changed pack points at the old hash. */
export interface StoredLayer extends PackLayerEntry {
  readonly path: string;
}

/** A pack that is ready on the device. */
export interface StoredPack extends Omit<PackManifestEntry, 'layers'> {
  readonly layers: readonly StoredLayer[];
}

/** A download in progress: which layers of `hash` are complete and verified, so a restart does not hash them again. */
export interface PendingPack {
  readonly hash: string;
  readonly verified: readonly string[];
}

/** The small index (`index.json`): pack key to what is ready, and what is half-downloaded. */
export interface PackIndex {
  readonly packs: Readonly<Record<string, StoredPack>>;
  readonly pending: Readonly<Record<string, PendingPack>>;
}

export const EMPTY_INDEX: PackIndex = { packs: {}, pending: {} };

/** A file being written; `close` flushes (also after an interruption, so a resume finds the bytes). */
export interface PackWriter {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/**
 * Where pack bytes live: OPFS on a device, a map in tests. Paths are `/`-separated and relative (`<hash>/<layer>.pmtiles`).
 * `supported: false` (no OPFS) makes the manager do nothing and the map keep using the network.
 */
export interface PackStorage {
  readonly supported: boolean;
  /** Size in bytes, undefined when the file does not exist. */
  size(path: string): Promise<number | undefined>;
  /** Opens for writing from `at` (the file is cut to `at` first; 0 starts it afresh). */
  open(path: string, at: number): Promise<PackWriter>;
  read(path: string, offset: number, length: number): Promise<Uint8Array>;
  /** The file as a lazy Blob (OPFS: the file itself, read on demand), for the pack file export. */
  blob(path: string): Promise<Blob | undefined>;
  remove(path: string): Promise<void>;
  /** Every pack file path (not the index). */
  list(): Promise<readonly string[]>;
  readText(path: string): Promise<string | undefined>;
  writeText(path: string, text: string): Promise<void>;
}

/** The answer to one ranged download request. `partial` is false when the server ignored the Range header. */
export interface PackDownload {
  readonly partial: boolean;
  readonly chunks: AsyncIterable<Uint8Array>;
}

/** The two calls to the server (A-032 items 3 and 4). A rejection means "could not reach it". */
export interface PackTransport {
  manifest(signal?: AbortSignal): Promise<PackManifest>;
  /** `GET url` with `Range: bytes=<from>-`. Throws on a status that is not 200 or 206. */
  download(url: string, from: number, signal?: AbortSignal): Promise<PackDownload>;
}

/** What the Offline tab shows per pack. */
export interface PackCount {
  readonly key: string;
  readonly label: string;
  readonly bytes: number;
  readonly tiles: number;
  readonly layers: number;
  /** When the server built the pack (the Offline tab shows it as the pack's date). */
  readonly built_at: string;
}

export interface PackCounts {
  readonly packs: readonly PackCount[];
  readonly totals: { readonly packs: number; readonly bytes: number; readonly tiles: number };
}

/** A layer file of a ready pack, readable by range (the protocol builds its PMTiles reader on it). */
export interface PackLayerFile {
  /** Unique per file (`<hash>/<layer>`): the reader's cache key. */
  readonly id: string;
  readonly layer: string;
  readonly tileType: PackTileType;
  readonly maxZoom: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** The Svelte store contract without Svelte: `subscribe` calls `run` at once and on every change. */
export interface Readable<T> {
  get(): T;
  subscribe(run: (value: T) => void): () => void;
}
