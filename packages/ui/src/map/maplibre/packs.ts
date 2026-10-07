// The offline-pack tile protocol (WP-662, v3 tile-protocol.ts): MapLibre asks `ubtile://<layer>/{z}/{x}/{y}`; the
// handler tries the packs on this device first, then the network, then overzooms from the layer's own `max_zoom`
// (the pack's coverage ends there; a coarser tile is cropped and scaled). One seam for any packed source (H6).
import type { PMTiles, Source } from 'pmtiles';
import type * as PmtilesLib from 'pmtiles';
import type { PackFile, PackFiles, PackRouting } from './packs-types';

export type { PackFile, PackFiles, PackRouting } from './packs-types';

export const PACK_PROTOCOL = 'ubtile';

export interface TileCoords {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

/** Where a tile sits inside its ancestor `levels` zoom levels up, as a fraction of the ancestor's size. */
export function ancestorQuadrant(
  child: TileCoords,
  levels: number,
): { parent: TileCoords; fx: number; fy: number; size: number } {
  const scale = 2 ** levels;
  const parent = { z: child.z - levels, x: Math.floor(child.x / scale), y: Math.floor(child.y / scale) };
  return {
    parent,
    fx: (child.x - parent.x * scale) / scale,
    fy: (child.y - parent.y * scale) / scale,
    size: 1 / scale,
  };
}

/** Crops the sub-square `(fx, fy, size)` (fractions) out of an encoded raster tile and scales it to a tile. */
export type CropTile = (
  tile: ArrayBuffer,
  q: { fx: number; fy: number; size: number },
) => Promise<ArrayBuffer>;

/** The browser crop: decode, draw the quadrant scaled up, encode as png (v3 `synthesizeFromParent`). */
export const canvasCrop: CropTile = async (tile, q) => {
  const bitmap = await createImageBitmap(new Blob([tile]));
  try {
    const out = new OffscreenCanvas(256, 256);
    const ctx = out.getContext('2d');
    if (ctx === null) throw new Error('2d context unavailable');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      bitmap,
      q.fx * bitmap.width,
      q.fy * bitmap.height,
      q.size * bitmap.width,
      q.size * bitmap.height,
      0,
      0,
      256,
      256,
    );
    return await (await out.convertToBlob({ type: 'image/png' })).arrayBuffer();
  } finally {
    bitmap.close();
  }
};

export interface PackProtocolDeps {
  readonly packs: PackFiles | undefined;
  /** The network leg: the tile bytes, or undefined when it is not there (offline, 404). */
  readonly fetchTile?: (url: string, signal: AbortSignal | undefined) => Promise<ArrayBuffer | undefined>;
  readonly crop?: CropTile;
  /** Does the project have a pack for this layer key (only those layers go through the protocol)? Default: none. */
  readonly hasLayer?: (layer: string) => boolean;
  /** The library loads on the first lookup only (R14). */
  readonly loadPmtiles?: () => Promise<typeof PmtilesLib>;
}

const defaultFetch: NonNullable<PackProtocolDeps['fetchTile']> = async (url, signal) => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return undefined;
  try {
    const res = await fetch(url, { credentials: 'same-origin', ...(signal === undefined ? {} : { signal }) });
    return res.ok ? await res.arrayBuffer() : undefined;
  } catch {
    return undefined;
  }
};

/** A 1x1 transparent png: the raster tile for a place no pack and no network has. */
const EMPTY_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (ch) => ch.charCodeAt(0),
);

const fill = (template: string, c: TileCoords): string =>
  template
    .replace('{s}', 'a')
    .replace('{z}', String(c.z))
    .replace('{x}', String(c.x))
    .replace('{y}', String(c.y))
    .replace('{r}', '');

/** Parses `ubtile://<layer>/<z>/<x>/<y>`. */
export function parseTileUrl(url: string): ({ layer: string } & TileCoords) | undefined {
  const m = /^ubtile:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/.exec(url);
  return m === null
    ? undefined
    : { layer: decodeURIComponent(m[1] ?? ''), z: Number(m[2]), x: Number(m[3]), y: Number(m[4]) };
}

export function createPackProtocol(deps: PackProtocolDeps): PackRouting {
  const templates = new Map<string, string>();
  const readers = new Map<string, Promise<PMTiles>>();
  const fetchTile = deps.fetchTile ?? defaultFetch;
  const crop = deps.crop ?? canvasCrop;

  const reader = (f: PackFile): Promise<PMTiles> => {
    let r = readers.get(f.id);
    if (r === undefined) {
      r = (deps.loadPmtiles ?? (() => import('pmtiles')))().then((lib) => {
        const source: Source = {
          getKey: () => f.id,
          getBytes: async (offset, length) => {
            const b = await f.read(offset, length);
            return { data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
          },
        };
        return new lib.PMTiles(source);
      });
      readers.set(f.id, r);
    }
    return r;
  };

  /** The tile from one pack file, or undefined when it holds none (or cannot be read). */
  const fromPack = async (
    f: PackFile,
    c: TileCoords,
    signal: AbortSignal | undefined,
  ): Promise<ArrayBuffer | undefined> => {
    try {
      return (await (await reader(f)).getZxy(c.z, c.x, c.y, signal))?.data;
    } catch {
      return undefined;
    }
  };

  const load = async (
    c: { layer: string } & TileCoords,
    signal: AbortSignal | undefined,
  ): Promise<ArrayBuffer> => {
    const files = (await deps.packs?.layerFiles(c.layer)) ?? [];
    for (const f of files) {
      if (c.z > f.maxZoom) continue;
      const data = await fromPack(f, c, signal);
      if (data !== undefined) return data;
    }
    const template = templates.get(c.layer);
    if (template !== undefined) {
      const data = await fetchTile(fill(template, c), signal);
      if (data !== undefined) return data;
    }
    for (const f of files) {
      if (c.z <= f.maxZoom || f.tileType === 'vector') continue;
      const q = ancestorQuadrant(c, c.z - f.maxZoom);
      const parent = await fromPack(f, q.parent, signal);
      if (parent !== undefined) return crop(parent, q);
    }
    // Nothing has this tile (offline, outside every pack): an empty tile, so MapLibre draws nothing there and
    // logs no error per tile while panning (v3 threw `Tile unavailable` here, which was a console error).
    return files[0]?.tileType === 'vector' ? new ArrayBuffer(0) : EMPTY_PNG.slice().buffer;
  };

  return {
    name: PACK_PROTOCOL,
    handler: async (params, abort) => {
      const c = parseTileUrl(params.url);
      if (c === undefined) throw new Error(`unknown tile url ${params.url}`);
      return { data: await load(c, abort.signal) };
    },
    has: (layer) => deps.hasLayer?.(layer) ?? false,
    registerTemplate: (layer, template) => void templates.set(layer, template),
    tileUrl: (layer) => `${PACK_PROTOCOL}://${encodeURIComponent(layer)}/{z}/{x}/{y}`,
  };
}
