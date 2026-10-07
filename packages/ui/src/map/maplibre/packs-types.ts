// The device's pack files as the protocol sees them. `@ueberblick/client` implements this shape (`PackManager.files`);
// the ui package does not import the client, so the shape is declared here too.
import type { PackTileType } from '@ueberblick/core/registry/admin';

export interface PackFile {
  /** Unique per file: the reader's cache key. */
  readonly id: string;
  readonly layer: string;
  readonly tileType: PackTileType;
  /** The layer's own built maximum zoom; above it the protocol overzooms. */
  readonly maxZoom: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface PackFiles {
  /** The ready files of a layer; empty when the device holds none (or has no OPFS). */
  layerFiles(layer: string): Promise<readonly PackFile[]>;
}

/** What the basemaps need to route a layer through the pack protocol (WP-662). */
export interface PackRouting {
  /** The `addProtocol` name and handler. */
  readonly name: string;
  readonly handler: (params: { url: string }, abort: AbortController) => Promise<{ data: ArrayBuffer }>;
  /** Does the project have a pack for this layer key? Only those layers are routed. */
  has(layer: string): boolean;
  /** Remembers the layer's network URL template (the protocol's second leg). */
  registerTemplate(layer: string, template: string): void;
  /** The tile URL a MapLibre source uses for the layer. */
  tileUrl(layer: string): string;
}

/**
 * Where the browser asks for tiles (A-033): the tile proxy of this project on this origin, never the provider.
 * `origin` is `location.origin` for MapLibre (its worker cannot resolve a relative URL); `''` keeps the URL relative.
 */
export interface TileProxy {
  readonly project: string;
  readonly origin: string;
}
