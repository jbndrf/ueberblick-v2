/**
 * The offline-pack tile estimate (A-032): how many web-mercator XYZ tiles a box needs over a zoom range.
 * Pure arithmetic, O(zoom levels), no I/O (R2). The build job and the admin dialog share it (R1).
 */
import { PACK_TILE_BYTES, type PackTileType } from '../registry/admin';

/** [west, south, east, north] in WGS84 degrees. */
export type Bounds = readonly [west: number, south: number, east: number, north: number];

/** Web mercator ends at this latitude. */
const MAX_LAT = 85.0511287798066;

const clampLat = (lat: number): number => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));

function tileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}

function tileY(lat: number, z: number): number {
  const rad = (clampLat(lat) * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * 2 ** z;
}

/** The first and last tile index of one axis that meet [lo, hi] (tiles that only touch an edge are out). */
function span(lo: number, hi: number, z: number): [number, number] {
  const last = 2 ** z - 1;
  const first = Math.max(0, Math.min(last, Math.floor(lo)));
  return [first, Math.max(first, Math.min(last, Math.ceil(hi) - 1))];
}

/** The inclusive tile index ranges of one zoom level that intersect the bounds (x west to east, y north to south). */
export function tileRanges(
  bounds: Bounds,
  zoom: number,
): { readonly x: readonly [number, number]; readonly y: readonly [number, number] } {
  const [w, s, e, n] = bounds;
  return { x: span(tileX(w, zoom), tileX(e, zoom), zoom), y: span(tileY(n, zoom), tileY(s, zoom), zoom) };
}

/** The number of tiles of one zoom level that intersect the bounds. */
export function tilesAtZoom(bounds: Bounds, zoom: number): number {
  const { x, y } = tileRanges(bounds, zoom);
  return (x[1] - x[0] + 1) * (y[1] - y[0] + 1);
}

/** The number of tiles from `minZoom` to `maxZoom` (both inclusive); 0 when the range is empty. */
export function tileCount(bounds: Bounds, minZoom: number, maxZoom: number): number {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) total += tilesAtZoom(bounds, z);
  return total;
}

/**
 * A layer's own built maximum: the pack's, capped by the highest zoom its source has, when known.
 * For a `pmtiles` source the config cannot know the archive's maximum (it is in the header), so this is an
 * upper bound: the build job (WP-350) caps from the header, and the manifest's per-layer `max_zoom` is
 * authoritative (A-032).
 */
export function layerMaxZoom(packMaxZoom: number, sourceMaxZoom: number | undefined): number {
  return sourceMaxZoom === undefined ? packMaxZoom : Math.min(packMaxZoom, sourceMaxZoom);
}

/** What the estimate needs to know of one layer of the pack. */
export interface PackLayerInput {
  readonly key: string;
  readonly tileType: PackTileType;
  readonly sourceMaxZoom: number | undefined;
}

export interface PackLayerEstimate {
  readonly key: string;
  readonly maxZoom: number;
  readonly tiles: number;
  readonly bytes: number;
}

export interface PackEstimate {
  readonly layers: readonly PackLayerEstimate[];
  readonly tiles: number;
  readonly bytes: number;
}

/** The estimate of a whole pack: one file per layer, each to its own max zoom. */
export function estimatePack(
  bounds: Bounds,
  minZoom: number,
  maxZoom: number,
  layers: readonly PackLayerInput[],
): PackEstimate {
  const per = layers.map((l): PackLayerEstimate => {
    const max = layerMaxZoom(maxZoom, l.sourceMaxZoom);
    const tiles = tileCount(bounds, minZoom, max);
    return { key: l.key, maxZoom: max, tiles, bytes: tiles * PACK_TILE_BYTES[l.tileType] };
  });
  return {
    layers: per,
    tiles: per.reduce((a, l) => a + l.tiles, 0),
    bytes: per.reduce((a, l) => a + l.bytes, 0),
  };
}
