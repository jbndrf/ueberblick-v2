/**
 * The layer forms as data (v3 `LayersSection.svelte:104-125` held one `$state` per field of the tile and WMS tabs): one
 * `LayerFormValues` per dialog, and the functions that turn it into a source, a draft or a patch. A new source type
 * (H1, H6) is an entry in `ADD_TABS` here plus its fields in `LayerSourceFields.svelte`.
 */
import { MAP_PRESETS, MAP_WMS_PRESETS, type MapLayerKind, type MapSourceType } from '@ueberblick/core';
import type { AdminKey } from '../../../routes/(admin)/admin/shell/messages';
import type { LayerDraft, LayerPatch, LayerRowData, LayerSource } from './layers-model';

/** The tabs of the add dialog after "Voreinstellungen": each is one source type with its own fields. */
export const ADD_TABS: ReadonlyArray<{
  readonly type: Exclude<MapSourceType, 'preset'>;
  readonly label: AdminKey;
}> = [
  { type: 'xyz', label: 'settings_layers_tab_tiles' },
  { type: 'wms', label: 'settings_layers_tab_wms' },
  { type: 'pmtiles', label: 'settings_layers_tab_pmtiles' },
  { type: 'geojson', label: 'settings_layers_tab_geojson' },
];

export interface LayerFormValues {
  name: string;
  url: string;
  attribution: string;
  /** Add: the "Als Basis-Layer festlegen" switch. */
  asBase: boolean;
  /** WMS. */
  wmsLayers: string;
  format: string;
  version: '1.1.1' | '1.3.0';
  transparent: boolean;
  /** PMTiles. */
  tileType: 'raster' | 'vector';
  sourceLayer: string;
  /** Edit only. */
  kind: MapLayerKind;
  /** Whole percent. */
  opacity: number;
  minzoom: string;
  maxzoom: string;
  roles: string[];
  onAtStart: boolean;
}

/** v3's defaults: PNG, WMS 1.1.1, transparent. */
export const emptyForm = (): LayerFormValues => ({
  name: '',
  url: '',
  attribution: '',
  asBase: false,
  wmsLayers: '',
  format: 'image/png',
  version: '1.1.1',
  transparent: true,
  tileType: 'raster',
  sourceLayer: '',
  kind: 'overlay',
  opacity: 100,
  minzoom: '',
  maxzoom: '',
  roles: [],
  onAtStart: false,
});

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The form an existing layer opens with. */
export function formOf(row: LayerRowData): LayerFormValues {
  const s = row.source;
  return {
    ...emptyForm(),
    name: row.label,
    url: row.url,
    attribution: row.attribution,
    asBase: row.kind === 'base',
    wmsLayers: text(s['layers']),
    format: text(s['format']) || 'image/png',
    version: s['version'] === '1.3.0' ? '1.3.0' : '1.1.1',
    transparent: s['transparent'] !== false,
    tileType: s['tile_type'] === 'vector' ? 'vector' : 'raster',
    sourceLayer: text(s['source_layer']),
    kind: row.kind,
    opacity: row.opacity,
    minzoom: row.minzoom === null ? '' : String(row.minzoom),
    maxzoom: row.maxzoom === null ? '' : String(row.maxzoom),
    roles: [...row.roles],
    onAtStart: row.onAtStart,
  };
}

/** The source of a form for one type. */
export function sourceOf(type: Exclude<MapSourceType, 'preset'>, f: LayerFormValues): LayerSource {
  const url = f.url.trim();
  switch (type) {
    case 'xyz':
      return { type, url };
    case 'wms':
      return {
        type,
        url,
        layers: f.wmsLayers.trim(),
        version: f.version,
        format: f.format.trim() || 'image/png',
        transparent: f.transparent,
      };
    case 'pmtiles':
      return {
        type,
        url,
        tile_type: f.tileType,
        ...(f.tileType === 'vector' && f.sourceLayer.trim() ? { source_layer: f.sourceLayer.trim() } : {}),
      };
    case 'geojson':
      return { type, url };
  }
}

const zoom = (s: string): number | undefined => (s.trim() === '' ? undefined : Number(s));

/** What the add dialog sends: v3 added as overlay unless "als Basis" was on. */
export function draftOf(type: Exclude<MapSourceType, 'preset'>, f: LayerFormValues): LayerDraft {
  return {
    label: f.name.trim(),
    kind: f.asBase ? 'base' : 'overlay',
    source: sourceOf(type, f),
    ...(f.attribution.trim() ? { attribution: f.attribution.trim() } : {}),
  };
}

/** A preset as a draft: the first one is the base when there is none yet (v3 `handleAddPreset`), else an overlay. */
export function presetDraft(preset: string, label: string, hasBase: boolean): LayerDraft {
  return { label, kind: hasBase ? 'overlay' : 'base', source: { type: 'preset', preset } };
}

/** What the edit dialog sends: every setting the dialog shows, `null` where it was emptied. */
export function patchOf(row: LayerRowData, f: LayerFormValues): LayerPatch {
  const source =
    row.type === 'preset' ? undefined : sourceOf(row.type as Exclude<MapSourceType, 'preset'>, f);
  const lo = zoom(f.minzoom);
  const hi = zoom(f.maxzoom);
  return {
    label: f.name.trim(),
    kind: f.kind,
    ...(source === undefined ? {} : { source }),
    attribution: f.attribution.trim() === '' ? null : f.attribution.trim(),
    opacity: f.opacity / 100,
    minzoom: lo ?? null,
    maxzoom: hi ?? null,
    roles: f.roles.length === 0 ? null : f.roles,
    on_at_start: f.onAtStart,
  };
}

/** One row of the Voreinstellungen tab. */
export interface PresetRow {
  readonly key: string;
  /** Tiles or WMS, for the row's second line. */
  readonly kind: 'tiles' | 'wms';
  readonly maxzoom: number;
  /** Whether a layer of the project already is this preset. */
  readonly isAdded: (layers: readonly LayerRowData[]) => boolean;
  /** The layer to add: a `preset` source for tile presets, an ordinary `wms` source for WMS presets (no special case downstream). */
  readonly draft: (label: string, hasBase: boolean) => LayerDraft;
}

/** v3's `PRESET_SOURCES` order: the tile presets, then the WMS ones. */
export const PRESET_ROWS: readonly PresetRow[] = [
  ...MAP_PRESETS.entries.map((p): PresetRow => ({
    key: p.key,
    kind: 'tiles',
    maxzoom: p.maxzoom,
    isAdded: (layers) => layers.some((l) => l.type === 'preset' && l.preset === p.key),
    draft: (label, hasBase) => presetDraft(p.key, label, hasBase),
  })),
  ...MAP_WMS_PRESETS.entries.map((p): PresetRow => ({
    key: p.key,
    kind: 'wms',
    maxzoom: p.maxzoom,
    isAdded: (layers) =>
      layers.some((l) => l.type === 'wms' && l.url === p.url && l.source['layers'] === p.layers),
    draft: (label, hasBase) => ({
      label,
      kind: hasBase ? 'overlay' : 'base',
      source: {
        type: 'wms',
        url: p.url,
        layers: p.layers,
        version: p.version,
        format: p.format,
        transparent: p.transparent,
      },
      attribution: p.attribution,
    }),
  })),
];
