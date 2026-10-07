/**
 * Where the build job takes the tiles of one layer from (A-032, A-033). A `LayerReader` hides the source type:
 * - `pmtiles`: the archive is read by range through `fetchRange` (the port of WP-350), near tiles in one request;
 * - `xyz` and `preset`: each tile comes through the tile service, so the build warms the proxy's cache and shares its
 *   per-host limiter. The same tile is never fetched twice, and a missing tile (404) is simply absent.
 */
import {
  isSameOriginPath,
  MAP_SOURCE_TYPES,
  tileHostPackCap,
  type MapLayer,
  type MapSourceType,
} from '@ueberblick/core';
import { Compression, TileType, tileIdToZxy } from 'pmtiles';
import { isSelfHosted, resolveSource, tileUrl, type ProxySource } from '../tiles/source';
import { sniffRaster } from '../tiles/sniff';
import type { TileResult } from '../tiles/service';
import type { Guard } from '../tiles/guard';
import { decompress, openArchive, type TileLocation } from './archive-read';
import { RangeNotFound, type FetchRange } from './fetch';

/** One tile through the tile service, bound to the project: what the builder reads xyz and preset layers with. */
export type PackTiles = (
  source: Extract<ProxySource, { kind: 'template' | 'pmtiles' }>,
  z: number,
  x: number,
  y: number,
) => Promise<TileResult>;

export interface ArchiveInfo {
  readonly tileType: TileType;
  readonly tileCompression: Compression;
  readonly metadata: Uint8Array;
}

export interface LayerReader {
  /** The highest zoom the source has (an archive header says), or `undefined` when the config knows it. */
  readonly zoomCap: number | undefined;
  /** Throws when the tiles of the pack are too many for the source's host policy. */
  check(tileCount: number): void;
  /** The stored bytes of the tiles that exist, by tile id. */
  read(tileIds: readonly number[]): Promise<Map<number, Uint8Array>>;
  /** What the written archive says about its tiles; `sample` is the first stored tile. */
  info(sample: Uint8Array): ArchiveInfo;
}

/** Tiles whose bytes lie this close are fetched with one request. */
const MERGE_GAP = 64 * 1024;
const MAX_REQUEST = 8 * 1024 * 1024;

interface Located {
  readonly tileId: number;
  readonly loc: TileLocation;
}

/** Reads the stored bytes of the located tiles, merging near neighbours into one request each. */
async function fetchTiles(
  fetchRange: FetchRange,
  url: string,
  found: readonly Located[],
): Promise<Map<number, Uint8Array>> {
  const byOffset = [...found].sort((a, b) => a.loc.offset - b.loc.offset);
  const groups: Located[][] = [];
  for (const t of byOffset) {
    const group = groups[groups.length - 1];
    const last = group?.[group.length - 1];
    if (group !== undefined && last !== undefined) {
      const end = last.loc.offset + last.loc.length;
      const first = (group[0] as Located).loc.offset;
      if (t.loc.offset - end <= MERGE_GAP && t.loc.offset + t.loc.length - first <= MAX_REQUEST) {
        group.push(t);
        continue;
      }
    }
    groups.push([t]);
  }
  const out = new Map<number, Uint8Array>();
  await Promise.all(
    groups.map(async (g) => {
      const first = (g[0] as Located).loc.offset;
      const last = g[g.length - 1] as Located;
      const bytes = await fetchRange(url, first, last.loc.offset + last.loc.length - first);
      for (const t of g)
        out.set(t.tileId, bytes.subarray(t.loc.offset - first, t.loc.offset - first + t.loc.length));
    }),
  );
  return out;
}

export interface ReaderDeps {
  readonly fetchRange: FetchRange;
  readonly tiles: PackTiles | undefined;
  /** The SSRF guard: a source it refuses fails the layer before any request. */
  readonly guard?: Guard | undefined;
}

const RASTER_TYPES: Record<string, TileType> = {
  png: TileType.Png,
  jpg: TileType.Jpeg,
  webp: TileType.Webp,
  avif: TileType.Avif,
};

const rasterInfo = (sample: Uint8Array): ArchiveInfo => {
  const format = sniffRaster(sample);
  return {
    tileType: RASTER_TYPES[format?.ext ?? ''] ?? TileType.Png,
    tileCompression: Compression.None,
    metadata: new TextEncoder().encode('{}'),
  };
};

/** A tile of a self-hosted template is never larger than this (`PACK_TILE_BYTES` caps what is stored anyway). */
const SELF_HOSTED_TILE_MAX = 1024 * 1024;

/** A template on this instance: each tile is read from the origin through `fetchRange` (no proxy, no guard). */
function selfHostedTemplate(fetchRange: FetchRange, template: string): LayerReader {
  return {
    zoomCap: undefined,
    check: () => undefined,
    async read(ids) {
      const out = new Map<number, Uint8Array>();
      await Promise.all(
        ids.map(async (tileId) => {
          const [z, x, y] = tileIdToZxy(tileId);
          try {
            out.set(tileId, await fetchRange(tileUrl(template, z, x, y), 0, SELF_HOSTED_TILE_MAX));
          } catch (e) {
            if (!(e instanceof RangeNotFound)) throw e; // a missing tile is absent, as for a remote xyz
          }
        }),
      );
      return out;
    },
    info: rasterInfo,
  };
}

/** The reader of a layer's source; throws for a source type that is not packable. */
export async function openReader(deps: ReaderDeps, layer: MapLayer): Promise<LayerReader> {
  const type = (layer.source as { type: MapSourceType }).type;
  if (!MAP_SOURCE_TYPES.get(type).packable) throw new Error(`a ${type} source cannot be packed`);
  const source = resolveSource(layer.source);
  if (source === undefined) throw new Error(`a ${type} source has no tiles to pack`);
  const target =
    source.kind === 'template'
      ? source.template.replace(/\{[a-z]+\}/g, '0')
      : source.kind === 'pmtiles'
        ? source.url
        : undefined;
  // A self-hosted source (a path on this instance) is read against the origin without the guard (A-033 item 9).
  if (target !== undefined && !isSameOriginPath(target)) await deps.guard?.check(target);
  if (source.kind === 'pmtiles') {
    const archive = await openArchive(deps.fetchRange, source.url);
    return {
      zoomCap: archive.header.maxZoom,
      check: () => undefined,
      async read(ids) {
        const found: Located[] = [];
        for (const tileId of ids) {
          const loc = await archive.locate(tileId);
          if (loc !== undefined) found.push({ tileId, loc });
        }
        return fetchTiles(deps.fetchRange, source.url, found);
      },
      info: () => ({
        tileType: archive.header.tileType,
        tileCompression: archive.header.tileCompression,
        metadata: decompress(archive.metadata, archive.header.internalCompression),
      }),
    };
  }
  if (source.kind !== 'template') throw new Error(`a ${type} source cannot be packed`);
  if (isSelfHosted(source)) return selfHostedTemplate(deps.fetchRange, source.template);
  const tiles = deps.tiles;
  if (tiles === undefined) throw new Error('the build has no tile service for this source');
  const cap = tileHostPackCap(source.template);
  return {
    zoomCap: undefined,
    check(count) {
      if (cap !== undefined && count > cap)
        throw new Error(
          `${count} tiles are more than the ${cap} this tile host allows in one pack (its usage policy discourages bulk downloads); make the area or the zoom range smaller`,
        );
    },
    async read(ids) {
      const out = new Map<number, Uint8Array>();
      await Promise.all(
        ids.map(async (tileId) => {
          const [z, x, y] = tileIdToZxy(tileId);
          const r = await tiles(source, z, x, y);
          if (r.kind === 'error') throw new Error(`tile ${z}/${x}/${y}: ${r.reason}`);
          if (r.kind === 'ok') out.set(tileId, r.bytes);
        }),
      );
      return out;
    },
    info: rasterInfo,
  };
}
