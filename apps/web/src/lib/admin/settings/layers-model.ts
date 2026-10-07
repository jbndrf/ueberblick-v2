/**
 * The Kartenebenen section's data (v3 `LayersSection.svelte`, over v4's `map.layers`, `map.order`): the rows the table
 * shows, the checks a layer form runs, and the key a new layer gets. The page's form and the server both call
 * `validateLayerDraft`, so a layer is refused in one way in both places (R1). The file side of the same rules is
 * `MapLayerSchema` (core), which the Doc checks again on every edit.
 */
import {
  defineRegistry,
  isSameOriginPath,
  localize,
  MAP_SOURCE_TYPES,
  orderedLayerKeys,
  type KeyOf,
  type MapConfig,
  type MapLayerKind,
  type MapSourceType,
} from '@ueberblick/core';

export const LAYER_FORM_ERRORS = defineRegistry([
  { key: 'name_required', description: 'The layer has no name.' },
  { key: 'url_required', description: 'The source needs a URL.' },
  { key: 'url_invalid', description: 'The URL is neither http(s) nor a path on this server.' },
  { key: 'tile_placeholders', description: 'A tile URL needs {z}, {x} and {y}.' },
  { key: 'wms_layers_required', description: 'A WMS source needs layer names.' },
  { key: 'source_layer_required', description: 'A vector PMTiles archive needs the layer to draw.' },
  { key: 'preset_unknown', description: 'The preset is not in the registry.' },
  { key: 'zoom_range', description: 'A zoom outside 0 to 24, or the minimum above the maximum.' },
] as const);
export type LayerFormError = KeyOf<typeof LAYER_FORM_ERRORS>;

/** A source as the file holds it: `type` and the keys that type has. */
export type LayerSource = { readonly type: MapSourceType } & Readonly<Record<string, unknown>>;

/** What the add dialog and the edit dialog hand over: a whole layer, the label as plain text. */
export interface LayerDraft {
  readonly label: string;
  readonly kind: MapLayerKind;
  readonly source: LayerSource;
  readonly attribution?: string | undefined;
  /** 0 to 1. */
  readonly opacity?: number | undefined;
  readonly minzoom?: number | undefined;
  readonly maxzoom?: number | undefined;
  readonly roles?: readonly string[] | undefined;
  readonly on_at_start?: boolean | undefined;
}

/** A change to one layer; `null` takes the setting away (the layer then has the default again). */
export interface LayerPatch {
  readonly label?: string;
  readonly kind?: MapLayerKind;
  readonly source?: LayerSource;
  readonly attribution?: string | null;
  readonly opacity?: number | null;
  readonly minzoom?: number | null;
  readonly maxzoom?: number | null;
  readonly roles?: readonly string[] | null;
  readonly on_at_start?: boolean | null;
}

/** One save of the section. */
export type LayerOp =
  | { readonly op: 'add'; readonly layer: LayerDraft }
  | { readonly op: 'update'; readonly key: string; readonly patch: LayerPatch }
  | { readonly op: 'remove'; readonly key: string }
  /** All layer keys, first is drawn lowest. */
  | { readonly op: 'order'; readonly keys: readonly string[] };

/** One row of the layer table. */
export interface LayerRowData {
  readonly key: string;
  readonly label: string;
  readonly kind: MapLayerKind;
  readonly type: MapSourceType;
  /** Whole percent, 0 to 100 (v3 showed `opacity` as a percentage). */
  readonly opacity: number;
  readonly roles: readonly string[];
  readonly onAtStart: boolean;
  /** The browser gets this layer through this server's tile proxy (A-033). */
  readonly proxied: boolean;
  readonly url: string;
  readonly preset: string;
  readonly attribution: string;
  readonly minzoom: number | null;
  readonly maxzoom: number | null;
  /** The source with every key it has, for the edit dialog. */
  readonly source: LayerSource;
}

export interface RoleOption {
  readonly key: string;
  readonly label: string;
}

export interface LayersView {
  /** In draw order, lowest first. */
  readonly layers: readonly LayerRowData[];
  readonly roles: readonly RoleOption[];
}

export const EMPTY_LAYERS: LayersView = { layers: [], roles: [] };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Whether the tile proxy serves a source: the type is proxied and the URL is not a path on this server. */
export function isProxied(source: LayerSource): boolean {
  if (!MAP_SOURCE_TYPES.get(source.type).proxied) return false;
  const url = source['url'];
  return !(typeof url === 'string' && isSameOriginPath(url));
}

export function layerRows(map: MapConfig | undefined, locale: string): LayerRowData[] {
  if (map === undefined) return [];
  return orderedLayerKeys(map).flatMap((key) => {
    const layer = map.layers[key];
    if (layer === undefined) return [];
    const source = layer.source as LayerSource;
    return [
      {
        key,
        label: localize(layer.label, [locale]),
        kind: layer.kind as MapLayerKind,
        type: source.type,
        opacity: Math.round((layer.opacity ?? 1) * 100),
        roles: layer.roles ?? [],
        onAtStart: layer.on_at_start === true,
        proxied: isProxied(source),
        url: str(source['url']),
        preset: str(source['preset']),
        attribution: layer.attribution ?? '',
        minzoom: layer.minzoom ?? null,
        maxzoom: layer.maxzoom ?? null,
        source,
      },
    ];
  });
}

const URL_SHAPE = /^https?:\/\/[^\s/]+/i;
const urlProblem = (url: string): LayerFormError | null => {
  if (url.trim() === '') return 'url_required';
  return URL_SHAPE.test(url) || isSameOriginPath(url) ? null : 'url_invalid';
};

/** What is wrong with a source, or null. */
export function validateSource(source: LayerSource): LayerFormError | null {
  const url = str(source['url']).trim();
  switch (source.type) {
    case 'xyz': {
      const bad = urlProblem(url);
      if (bad !== null) return bad;
      return ['{z}', '{x}', '{y}'].every((p) => url.includes(p)) ? null : 'tile_placeholders';
    }
    case 'wms':
      return urlProblem(url) ?? (str(source['layers']).trim() === '' ? 'wms_layers_required' : null);
    case 'pmtiles':
      return (
        urlProblem(url) ??
        (source['tile_type'] === 'vector' && str(source['source_layer']).trim() === ''
          ? 'source_layer_required'
          : null)
      );
    case 'geojson':
      return urlProblem(url);
    case 'preset':
      return str(source['preset']) === '' ? 'preset_unknown' : null;
  }
}

/** What is wrong with a whole layer (name, source, zoom range), or null. */
export function validateLayerDraft(layer: LayerDraft): LayerFormError | null {
  if (layer.label.trim() === '') return 'name_required';
  const bad = validateSource(layer.source);
  if (bad !== null) return bad;
  const { minzoom: lo, maxzoom: hi } = layer;
  const out = (z: number | undefined): boolean => z !== undefined && !(z >= 0 && z <= 24);
  if (out(lo) || out(hi) || (lo !== undefined && hi !== undefined && lo > hi)) return 'zoom_range';
  return null;
}

/** The key a new layer gets: its name as a config key (`^[a-z][a-z0-9_]*$`), made unique among `taken`. */
export function layerKeyFor(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const slug = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = /^[a-z]/.test(slug) ? slug : `ebene_${slug}`.replace(/_$/, '');
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** The base layers' names, v3's description line under the heading. */
export const baseNames = (rows: readonly LayerRowData[]): string[] =>
  rows.filter((r) => r.kind === 'base').map((r) => r.label);
