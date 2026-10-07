import { defineRegistry, type KeyOf } from './define';

/** Kinds of map background layer: exactly one base is shown at a time, overlays any number. */
export const MAP_LAYER_KINDS = defineRegistry([
  { key: 'base', description: 'A background map; one is active at a time.' },
  { key: 'overlay', description: 'A layer drawn over the base; any number may be on.' },
] as const);
export type MapLayerKind = KeyOf<typeof MAP_LAYER_KINDS>;

/**
 * Where a map layer gets its data (H1, H6: new formats are new entries here and a shape in `schema/map.ts`).
 * - `packable`: an offline pack may hold it (A-032, A-033). Raster sources a proxy can cache (`xyz`, `preset`) and
 *   `pmtiles` are packable; `wms` (render per request) and `geojson` (data, not tiles) are not.
 * - `proxied`: the server serves it to browsers through the tile proxy (A-033), so the browser talks only to this
 *   server and the upstream origin needs no entry in the CSP. `geojson` is data the map loads itself.
 */
export const MAP_SOURCE_TYPES = defineRegistry([
  {
    key: 'xyz',
    description: 'A raster tile URL template with {z}, {x}, {y}.',
    packable: true,
    proxied: true,
  },
  {
    key: 'wms',
    description: 'An OGC WMS endpoint, requested as raster tiles.',
    packable: false,
    proxied: true,
  },
  { key: 'geojson', description: 'A GeoJSON file at a URL.', packable: false, proxied: false },
  {
    key: 'pmtiles',
    description: 'A PMTiles archive (raster or vector) at a URL.',
    packable: true,
    proxied: true,
  },
  {
    key: 'preset',
    description: 'A named, ready-made source from MAP_PRESETS.',
    packable: true,
    proxied: true,
  },
] as const);
export type MapSourceType = KeyOf<typeof MAP_SOURCE_TYPES>;

/** Ready-made map sources. No commercial imagery presets (owner Q22). */
export const MAP_PRESETS = defineRegistry([
  {
    key: 'osm',
    description: 'OpenStreetMap standard tiles.',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    tileSize: 256,
    maxzoom: 19,
    attribution: '© OpenStreetMap contributors',
  },
  {
    key: 'osm_de',
    description: 'OpenStreetMap Germany tiles (v3 preset osm-de).',
    tiles: ['https://tile.openstreetmap.de/{z}/{x}/{y}.png'],
    tileSize: 256,
    maxzoom: 18,
    attribution: 'OpenStreetMap contributors',
  },
  {
    key: 'carto_light',
    description: 'CartoDB Positron (light) tiles (v3 preset carto-light).',
    tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
    tileSize: 256,
    maxzoom: 20,
    attribution: 'CartoDB',
  },
  {
    key: 'carto_dark',
    description: 'CartoDB Dark Matter tiles (v3 preset carto-dark).',
    tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
    tileSize: 256,
    maxzoom: 20,
    attribution: 'CartoDB',
  },
] as const);
export type MapPreset = KeyOf<typeof MAP_PRESETS>;

/**
 * Reserved layer keys the participant app draws without the project declaring them. `default-osm` is the base v3's
 * `MapCanvas` drew when a project configured no base layer (`MapCanvas.svelte:203,357`): the `preset` below. The tile
 * proxy serves it only to a caller who sees no base layer (`hasBaseLayer`), through the same source, host policy and
 * cache as a declared `preset: osm` layer. The client and the server both read the key from here (R1, R6).
 */
export const MAP_RESERVED_LAYERS = defineRegistry([
  {
    key: 'default-osm',
    description: 'The synthetic OSM base a project without a base layer is drawn on.',
    preset: 'osm',
  },
] as const);
export const DEFAULT_BASE_LAYER = MAP_RESERVED_LAYERS.get('default-osm');

/**
 * A layer URL that is a path on this instance (`/tiles/a.pmtiles`): self-hosted, it never leaves the instance, so
 * there is nothing to proxy. A protocol-relative `//host/x` is NOT a path: it names a host, so it stays absolute. The URL parser also reads `\\` as `/` and drops tab and line breaks, so `/\\host` and `/<TAB>/host` are rejected too: no backslash and no control character anywhere.
 */
export const isSameOriginPath = (url: string): boolean =>
  /^\/(?![/\\])/.test(url) && !/[\\\u0000-\u001f\u007f]/.test(url);

// The pure helpers below live beside the registry, not in `schema/map.ts`, because participant code
// (client, ui) may not import the Zod schema (dependency-cruiser `participant-core-subpaths`).

/** The part of a map config the helpers read; `MapConfig` of `schema/map.ts` fits it. */
export interface MapLayersLike {
  readonly layers: Readonly<
    Record<
      string,
      {
        readonly kind: string;
        readonly roles?: readonly string[] | undefined;
        readonly on_at_start?: boolean | undefined;
      }
    >
  >;
  readonly order?: readonly string[] | undefined;
}

/** True when at least one of the layers is a base (so the synthetic default base is not needed). */
export const hasBaseLayer = (map: MapLayersLike): boolean =>
  Object.values(map.layers).some((l) => l.kind === 'base');

/** What is on: one base (or none) and any number of overlays, by layer key. */
export interface MapSelection {
  readonly base: string | undefined;
  readonly overlays: readonly string[];
}

/** The layer keys in draw order: `order` first, then the rest as authored. */
export function orderedLayerKeys(map: MapLayersLike): string[] {
  const first = (map.order ?? []).filter((k) => k in map.layers);
  const set = new Set(first);
  return [...first, ...Object.keys(map.layers).filter((k) => !set.has(k))];
}

/** The layers a participant with these roles may see: those without `roles` and those matching any. */
export function layersForRoles<M extends MapLayersLike>(map: M, roles: readonly string[]): M {
  const mine = new Set(roles);
  const layers = Object.fromEntries(
    Object.entries(map.layers).filter(([, l]) => l.roles === undefined || l.roles.some((r) => mine.has(r))),
  );
  return {
    ...map,
    layers,
    ...(map.order === undefined ? {} : { order: map.order.filter((k) => k in layers) }),
  };
}

/** The part of a map config `packsForRoles` reads: the layers and the offline packs that name them. */
export interface MapPacksLike {
  readonly layers: MapLayersLike['layers'];
  readonly packs?:
    | Readonly<
        Record<string, { readonly roles?: readonly string[] | undefined; readonly layers: readonly string[] }>
      >
    | undefined;
}

/** One pack a participant may see and the layers of it they see, in the pack's own order. */
export interface PackAudience {
  readonly key: string;
  readonly layers: readonly string[];
}

/**
 * The offline packs a participant with these roles may see (A-032 items 3 and 4; the one audience rule, R1): the
 * pack's `roles` is absent or matches one of theirs, and at least one of its layers is visible to them through
 * `layersForRoles`. A pack whose layers they see only partly lists just those layers. A layer the map does not
 * declare is not visible.
 */
export function packsForRoles(map: MapPacksLike, roles: readonly string[]): PackAudience[] {
  const mine = new Set(roles);
  const visible = layersForRoles(map, roles).layers;
  return Object.entries(map.packs ?? {}).flatMap(([key, pack]) => {
    if (pack.roles !== undefined && !pack.roles.some((r) => mine.has(r))) return [];
    const layers = pack.layers.filter((l) => l in visible);
    return layers.length === 0 ? [] : [{ key, layers }];
  });
}

/** What is on when the map first opens: the first base with `on_at_start` (else the first base) and the overlays that are on. */
export function defaultSelection(map: MapLayersLike): MapSelection {
  const keys = orderedLayerKeys(map);
  const ofKind = (kind: string): string[] => keys.filter((k) => map.layers[k]?.kind === kind);
  const bases = ofKind('base');
  const base = bases.find((k) => map.layers[k]?.on_at_start === true) ?? bases[0];
  return { base, overlays: ofKind('overlay').filter((k) => map.layers[k]?.on_at_start === true) };
}

/** Keep the choice that still fits the config; fall back to the default for the base. */
export function resolveSelection(map: MapLayersLike, choice: MapSelection | undefined): MapSelection {
  const fallback = defaultSelection(map);
  if (choice === undefined) return fallback;
  const keys = orderedLayerKeys(map);
  const of = (kind: string) => keys.filter((k) => map.layers[k]?.kind === kind);
  const bases = of('base');
  const base = choice.base !== undefined && bases.includes(choice.base) ? choice.base : fallback.base;
  const wanted = new Set(choice.overlays);
  return { base, overlays: of('overlay').filter((k) => wanted.has(k)) };
}
