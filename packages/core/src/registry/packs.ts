import { defineRegistry, type KeyOf } from './define';
import { MAP_PRESETS } from './map-layers';

/**
 * Limits of one offline pack (A-032, R6). The checker refuses a pack whose estimate is above `max_tiles` or
 * `max_bytes`; the zoom range is the one web-mercator pyramid the build job can extract. Raising a limit is a
 * change here, never a per-project setting.
 */
export const PACK_LIMITS = defineRegistry([
  { key: 'max_tiles', description: 'The most tiles one pack may hold, all layers together.', value: 250_000 },
  { key: 'max_bytes', description: 'The largest estimated size of one pack in bytes.', value: 1_000_000_000 },
  { key: 'min_zoom', description: 'The lowest zoom a pack may start at.', value: 0 },
  { key: 'max_zoom', description: 'The highest zoom a pack may reach.', value: 22 },
] as const);
export type PackLimit = KeyOf<typeof PACK_LIMITS>;

/** The value of one limit. */
export function packLimit(key: PackLimit): number {
  return PACK_LIMITS.get(key).value;
}

/** Tile types of a pack layer file (the manifest's `tile_type`). Only raster tiles can be cropped to overzoom. */
export const PACK_TILE_TYPES = defineRegistry([
  { key: 'raster', description: 'Image tiles (png, jpeg, webp).' },
  { key: 'vector', description: 'Vector tiles (mvt); MapLibre overscales them itself.' },
] as const);
export type PackTileType = KeyOf<typeof PACK_TILE_TYPES>;

/** What one tile weighs on average, by tile type; the estimate multiplies it by the tile count. */
export const PACK_TILE_BYTES = {
  raster: 15_000,
  vector: 6_000,
} as const satisfies Record<PackTileType, number>;

/**
 * The build state of one (pack, layer) file on the server (A-032 item 2, WP-350). Not the device's `PACK_STATES`
 * (WP-662): this is the build job's progress, the device sees only `ready` packs.
 */
export const PACK_BUILD_STATES = defineRegistry([
  { key: 'queued', description: 'Waiting for the build worker.' },
  { key: 'building', description: 'The worker is extracting the tiles; progress is persisted.' },
  { key: 'ready', description: 'The pmtiles file is complete and can be served.' },
  { key: 'failed', description: 'The build gave up; the reason is stored. An admin can rebuild it.' },
] as const);
export type PackBuildState = KeyOf<typeof PACK_BUILD_STATES>;

/** The part of a map layer the pack helpers read; `MapLayer` fits it. */
export interface PackLayerLike {
  readonly source: {
    readonly type: string;
    readonly tile_type?: string | undefined;
    readonly preset?: string | undefined;
  };
  readonly maxzoom?: number | undefined;
}

/** What the layer's tiles are: a pmtiles archive says so, everything else is raster. */
export function packTileType(layer: PackLayerLike): PackTileType {
  return layer.source.type === 'pmtiles' && layer.source.tile_type === 'vector' ? 'vector' : 'raster';
}

/**
 * The highest zoom the layer's source has tiles for, when the config says: a preset's own maximum (capped
 * by the layer's `maxzoom`), else the layer's `maxzoom`. `undefined` means unknown (the build job reads a
 * pmtiles header).
 */
export function sourceMaxZoom(layer: PackLayerLike): number | undefined {
  if (layer.source.type === 'preset') {
    const preset = MAP_PRESETS.entries.find((p) => p.key === layer.source.preset);
    if (preset !== undefined) {
      return layer.maxzoom === undefined ? preset.maxzoom : Math.min(layer.maxzoom, preset.maxzoom);
    }
  }
  return layer.maxzoom;
}

/** Progress states of an offline pack on the device, in the order a download goes through them (A-032, WP-662). */
export const PACK_STATES = defineRegistry([
  { key: 'absent', description: 'The server lists the pack; the device holds nothing of it.' },
  { key: 'queued', description: 'A download is asked for and waits its turn.' },
  { key: 'downloading', description: 'Layer files are being fetched into the device store.' },
  { key: 'ready', description: 'Every layer file is on the device and verified; the map reads it.' },
  {
    key: 'failed',
    description: 'The download stopped; the progress carries the reason. An older ready version stays.',
  },
] as const);
export type PackState = KeyOf<typeof PACK_STATES>;
