// Map backgrounds (project file `map.layers`) as MapLibre sources and layers, drawn below every
// `ub-*` feature layer. Pure spec building plus one function that applies a change of choice to a
// live map. The core decides which layers a participant may see (`layersForRoles`); this module
// only draws what it is given.
import { isSameOriginPath, MAP_PRESETS, orderedLayerKeys, resolveSelection } from '@ueberblick/core/registry';
import type { MapConfig, MapLayer } from '@ueberblick/core/model';
import type { MapSelection } from '@ueberblick/core/registry';
import type { StyleSpecValidator } from '../view-style';
import type { MlMap } from './api';
import type { PackRouting, TileProxy } from './packs-types';

export type { TileProxy };

/** The part of a MapLibre map this module drives. */
export type BasemapMap = Pick<MlMap, 'addSource' | 'addLayer' | 'removeLayer' | 'removeSource' | 'moveLayer'>;

export { resolveSelection };

/** What is on: one base (or none) and any number of overlays, by layer key. */
export type BasemapSelection = MapSelection;

export interface BasemapSpecs {
  readonly sources: readonly { readonly id: string; readonly spec: unknown }[];
  /** In draw order, lowest first. */
  readonly layers: readonly unknown[];
}

const proxyBase = (proxy: TileProxy, kind: 'tiles' | 'wms', key: string): string =>
  `${proxy.origin}/api/p/${encodeURIComponent(proxy.project)}/${kind}/${encodeURIComponent(key)}`;

/** The `{z}/{x}/{y}` tile URL of a layer on the proxy (xyz, preset, pmtiles). */
export const proxyTileTemplate = (proxy: TileProxy, key: string): string =>
  `${proxyBase(proxy, 'tiles', key)}/{z}/{x}/{y}`;

const proxyWmsTemplate = (proxy: TileProxy, key: string): string =>
  `${proxyBase(proxy, 'wms', key)}?bbox={bbox-epsg-3857}&width=${256}&height=${256}&crs=EPSG:3857`;

const PREFIX = 'bm-';
const TILE = 256;
const FILL = '#2b6cb0';

type Rec = Record<string, unknown>;
type SourceConfig = MapLayer['source'] & Rec;

function wmsTiles(s: SourceConfig): string {
  const url = String(s['url']);
  const version = typeof s['version'] === 'string' ? s['version'] : '1.3.0';
  const crs = version === '1.1.1' ? 'srs' : 'crs';
  const format = typeof s['format'] === 'string' ? s['format'] : 'image/png';
  const params = [
    'service=WMS',
    'request=GetMap',
    `version=${version}`,
    `layers=${encodeURIComponent(String(s['layers']))}`,
    'styles=',
    `format=${encodeURIComponent(format)}`,
    `transparent=${s['transparent'] === false ? 'false' : 'true'}`,
    `width=${TILE}`,
    `height=${TILE}`,
    `${crs}=EPSG:3857`,
    'bbox={bbox-epsg-3857}',
  ];
  return `${url}${url.includes('?') ? '&' : '?'}${params.join('&')}`;
}

function rasterSource(tiles: string[], tileSize: number, layer: MapLayer, extra: Rec = {}): Rec {
  const spec: Rec = { type: 'raster', tiles, tileSize, ...extra };
  if (layer.attribution !== undefined) spec['attribution'] = layer.attribution;
  if (layer.minzoom !== undefined) spec['minzoom'] = layer.minzoom;
  if (layer.maxzoom !== undefined) spec['maxzoom'] = layer.maxzoom;
  return spec;
}

/** A layer with a pack on the device draws through the pack protocol, which falls back to the layer's own URL. */
function routed(key: string, tiles: string[], packs: PackRouting | undefined): string[] {
  const template = tiles[0];
  if (packs === undefined || template === undefined || !packs.has(key)) return tiles;
  packs.registerTemplate(key, template);
  return [packs.tileUrl(key)];
}

/**
 * A proxied source (registry `proxied`) is read through the proxy; a self-hosted path on this instance never leaves
 * it, so it stays direct (A-033 item 9). Without a proxy (the builder's style check) the layer's own URL is used.
 */
function viaProxy(proxy: TileProxy | undefined, ownUrl: string): proxy is TileProxy {
  return proxy !== undefined && !isSameOriginPath(ownUrl);
}

function sourceSpec(
  key: string,
  layer: MapLayer,
  packs: PackRouting | undefined,
  proxy: TileProxy | undefined,
): { spec: Rec; vectorLayer?: string } | undefined {
  const s = layer.source as SourceConfig;
  switch (s['type']) {
    case 'xyz': {
      const own = String(s['url']);
      const tiles = viaProxy(proxy, own) ? proxyTileTemplate(proxy, key) : own;
      return { spec: rasterSource(routed(key, [tiles], packs), Number(s['tile_size'] ?? TILE), layer) };
    }
    case 'wms':
      return {
        spec: rasterSource(
          [viaProxy(proxy, String(s['url'])) ? proxyWmsTemplate(proxy, key) : wmsTiles(s)],
          TILE,
          layer,
        ),
      };
    case 'preset': {
      const p = MAP_PRESETS.entries.find((e) => e.key === s['preset']);
      if (p === undefined) return undefined;
      const tiles = proxy === undefined ? [...p.tiles] : [proxyTileTemplate(proxy, key)];
      const spec = rasterSource(routed(key, tiles, packs), p.tileSize, layer, { maxzoom: p.maxzoom });
      spec['attribution'] ??= p.attribution;
      if (layer.maxzoom !== undefined) spec['maxzoom'] = Math.min(layer.maxzoom, p.maxzoom);
      return { spec };
    }
    case 'geojson': {
      const spec: Rec = { type: 'geojson', data: String(s['url']) };
      if (layer.attribution !== undefined) spec['attribution'] = layer.attribution;
      return { spec };
    }
    case 'pmtiles': {
      const vector = s['tile_type'] === 'vector';
      const own = String(s['url']);
      // A remote archive is drawn like xyz from the per-tile route (the server reads it by range); a file on this
      // instance stays on the pmtiles protocol.
      // A pmtiles layer with a pack on the device draws through the pack protocol like xyz (v3 packed uploaded
      // tilesets and read them through `ubtile`); the proxy's per-tile route is its network fallback.
      const kind = vector ? 'vector' : 'raster';
      const packed = proxy !== undefined && packs !== undefined && packs.has(key);
      const spec: Rec = packed
        ? { type: kind, tiles: routed(key, [proxyTileTemplate(proxy, key)], packs) }
        : viaProxy(proxy, own)
          ? { type: kind, tiles: [proxyTileTemplate(proxy, key)] }
          : { type: kind, url: `pmtiles://${own}` };
      if (!vector) spec['tileSize'] = TILE;
      if (layer.attribution !== undefined) spec['attribution'] = layer.attribution;
      return vector ? { spec, vectorLayer: String(s['source_layer']) } : { spec };
    }
    default:
      return undefined;
  }
}

/** `advanced` keys apply to the layers whose type they name (`line-color` to line layers). */
function advancedFor(layer: MapLayer, type: string): { paint: Rec; layout: Rec } {
  const fits = (k: string): boolean => k === 'visibility' || k.startsWith(`${type}-`);
  const pick = (r: Record<string, unknown> | undefined): Rec =>
    Object.fromEntries(Object.entries(r ?? {}).filter(([k]) => fits(k)));
  return { paint: pick(layer.advanced?.paint), layout: pick(layer.advanced?.layout) };
}

function zoomRange(layer: MapLayer): Rec {
  const r: Rec = {};
  if (layer.minzoom !== undefined) r['minzoom'] = layer.minzoom;
  if (layer.maxzoom !== undefined) r['maxzoom'] = layer.maxzoom;
  return r;
}

function layerSpecs(key: string, layer: MapLayer, vectorLayer: string | undefined, raster: boolean): Rec[] {
  const id = `${PREFIX}${key}`;
  const opacity = layer.opacity ?? 1;
  const make = (type: string, suffix: string, extra: Rec, paint: Rec): Rec => {
    const adv = advancedFor(layer, type);
    const spec: Rec = {
      id: suffix === '' ? id : `${id}-${suffix}`,
      type,
      source: id,
      ...zoomRange(layer),
      ...extra,
      paint: { ...paint, ...adv.paint },
    };
    if (vectorLayer !== undefined) spec['source-layer'] = vectorLayer;
    if (Object.keys(adv.layout).length > 0) spec['layout'] = adv.layout;
    return spec;
  };
  if (raster) return [make('raster', '', {}, { 'raster-opacity': opacity, 'raster-fade-duration': 0 })];
  return [
    make(
      'fill',
      'fill',
      { filter: ['==', ['geometry-type'], 'Polygon'] },
      { 'fill-color': FILL, 'fill-opacity': 0.3 * opacity },
    ),
    make(
      'line',
      'line',
      { filter: ['!=', ['geometry-type'], 'Point'] },
      { 'line-color': FILL, 'line-width': 2, 'line-opacity': opacity },
    ),
    make(
      'circle',
      'point',
      { filter: ['==', ['geometry-type'], 'Point'] },
      { 'circle-color': FILL, 'circle-radius': 5, 'circle-opacity': opacity },
    ),
  ];
}

/** Sources and layers for the selected keys: the base first, then overlays in draw order. */
export function basemapSpecs(
  config: MapConfig,
  selection: BasemapSelection,
  packs?: PackRouting,
  proxy?: TileProxy,
): BasemapSpecs {
  const overlays = new Set(selection.overlays);
  const keys = [
    ...(selection.base === undefined ? [] : [selection.base]),
    ...orderedLayerKeys(config).filter((k) => overlays.has(k)),
  ];
  const sources: { id: string; spec: unknown }[] = [];
  const layers: unknown[] = [];
  for (const key of keys) {
    const layer = config.layers[key];
    const src = layer === undefined ? undefined : sourceSpec(key, layer, packs, proxy);
    if (layer === undefined || src === undefined) continue;
    sources.push({ id: `${PREFIX}${key}`, spec: src.spec });
    layers.push(...layerSpecs(key, layer, src.vectorLayer, src.spec['type'] === 'raster'));
  }
  return { sources, layers };
}

const idOf = (spec: unknown): string => (spec as { id: string }).id;

/**
 * Move a live map from `prev` to `next`: removes what went off, adds sources before layers, and puts
 * every basemap layer in order below `beforeId` (the lowest feature layer). Layers that stay are not touched.
 */
export function applyBasemaps(
  map: BasemapMap,
  config: MapConfig,
  prev: BasemapSelection | undefined,
  next: BasemapSelection,
  beforeId?: string,
  packs?: PackRouting,
  proxy?: TileProxy,
): void {
  const before = basemapSpecs(config, prev ?? { base: undefined, overlays: [] }, packs, proxy);
  const after = basemapSpecs(config, next, packs, proxy);
  const keepLayers = new Set(after.layers.map(idOf));
  const keepSources = new Set(after.sources.map((s) => s.id));
  for (const l of before.layers) if (!keepLayers.has(idOf(l))) map.removeLayer(idOf(l));
  for (const s of before.sources) if (!keepSources.has(s.id)) map.removeSource(s.id);
  const hadLayers = new Set(before.layers.map(idOf));
  const hadSources = new Set(before.sources.map((s) => s.id));
  for (const s of after.sources) if (!hadSources.has(s.id)) map.addSource(s.id, s.spec);
  const added = after.layers.filter((l) => !hadLayers.has(idOf(l)));
  for (const l of added) map.addLayer(l);
  if (added.length === 0) return;
  const ids = after.layers.map(idOf);
  const isNew = new Set(added.map(idOf));
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i] as string;
    if (!isNew.has(id)) continue;
    const successor = ids[i + 1] ?? beforeId;
    if (successor !== undefined) map.moveLayer(id, successor);
  }
}

export interface BasemapError {
  /** The layer key in `map.layers`. */
  readonly layer: string;
  readonly message: string;
}

/**
 * Check every layer's `advanced` style against the MapLibre Style Spec. Messages are the Style Spec's own;
 * a key that fits no layer the source draws is reported too.
 */
export function basemapErrors(config: MapConfig, spec: Pick<StyleSpecValidator, 'validate'>): BasemapError[] {
  const errors: BasemapError[] = [];
  for (const [key, layer] of Object.entries(config.layers)) {
    const alone: BasemapSelection =
      layer.kind === 'base' ? { base: key, overlays: [] } : { base: undefined, overlays: [key] };
    const { sources, layers } = basemapSpecs(config, alone);
    const types = layers.map((l) => (l as { type: string }).type);
    const all = { ...layer.advanced?.paint, ...layer.advanced?.layout };
    for (const k of Object.keys(all)) {
      if (k !== 'visibility' && !types.some((t) => k.startsWith(`${t}-`)))
        errors.push({
          layer: key,
          message: `${k} fits none of the ${types.join(', ')} layers of this source`,
        });
    }
    const style = { version: 8, sources: Object.fromEntries(sources.map((s) => [s.id, s.spec])), layers };
    for (const e of spec.validate(style as never)) errors.push({ layer: key, message: e.message });
  }
  return errors;
}
