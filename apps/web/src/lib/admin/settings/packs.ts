/**
 * The Offline-Pakete the section lists and edits (v3 `OfflinePacksSection.svelte`) as plain data computed from a project
 * file. A pack is `map.packs.<key>` (A-032): bounds, zoom range, layers and an optional audience. The estimate is core's
 * `estimatePack`, the function the checker and the build job use, so the dialog and the publish check never disagree (R1).
 */
import { defineRegistry, localize, type KeyOf, type MapLayer, type TemplateFile } from '@ueberblick/core';
import { estimatePack, type Bounds } from '@ueberblick/core/geo';
import { MAP_SOURCE_TYPES, type MapSourceType } from '@ueberblick/core/registry';
import { packLimit, packTileType, sourceMaxZoom } from '@ueberblick/core/registry/admin';

/** A pack as the draft holds it. `roles` empty means everyone who sees the layers (v3: "leave empty for all roles"). */
export interface PackRow {
  readonly key: string;
  readonly name: string;
  readonly bounds: Bounds;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly layers: readonly string[];
  readonly roles: readonly string[];
}

/** One map layer the dialog offers (v3 "Einzuschließende Layer"). A layer no pack can hold is shown but not selectable. */
export interface PackLayerOption {
  readonly key: string;
  readonly label: string;
  readonly base: boolean;
  readonly packable: boolean;
}

export interface PackRoleOption {
  readonly key: string;
  readonly label: string;
  readonly description: string;
}

/** What the dialog sends. A missing `key` is a new pack. */
export interface PackValues {
  readonly key?: string;
  readonly name: string;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly bounds: Bounds;
  readonly layers: readonly string[];
  readonly roles: readonly string[];
}

/** v3's form defaults (`resetPackageForm`: zoom 10 to 16). */
export const PACK_FORM_DEFAULTS = { minZoom: 10, maxZoom: 16 } as const;

export function packRows(file: TemplateFile, locale: string): PackRow[] {
  return Object.entries(file.map?.packs ?? {}).map(([key, p]) => ({
    key,
    name: localize(p.label, [locale]) || key,
    bounds: p.bounds,
    minZoom: p.min_zoom,
    maxZoom: p.max_zoom,
    layers: p.layers,
    roles: p.roles ?? [],
  }));
}

export function packLayerOptions(file: TemplateFile, locale: string): PackLayerOption[] {
  return Object.entries(file.map?.layers ?? {}).map(([key, l]) => ({
    key,
    label: localize(l.label, [locale]) || key,
    base: l.kind === 'base',
    packable: MAP_SOURCE_TYPES.get(l.source.type as MapSourceType).packable,
  }));
}

export function packRoleOptions(file: TemplateFile, locale: string): PackRoleOption[] {
  return Object.entries(file.roles ?? {}).map(([key, r]) => ({
    key,
    label: localize(r.label, [locale]) || key,
    description: localize(r.description, [locale]),
  }));
}

/** The estimate of a pack, over the file's own layers. Layers the file does not hold count for nothing. */
export function estimateOf(
  file: TemplateFile,
  v: Pick<PackValues, 'bounds' | 'minZoom' | 'maxZoom' | 'layers'>,
): { readonly tiles: number; readonly bytes: number } {
  const layers = file.map?.layers ?? {};
  return estimatePack(
    v.bounds,
    v.minZoom,
    v.maxZoom,
    v.layers.flatMap((k) => {
      const layer: MapLayer | undefined = layers[k];
      return layer === undefined
        ? []
        : [{ key: k, tileType: packTileType(layer), sourceMaxZoom: sourceMaxZoom(layer) }];
    }),
  );
}

export const PACK_PROBLEMS = defineRegistry([
  { key: 'region', description: 'No region is drawn yet (v3: "Please draw a region").' },
  { key: 'name', description: 'The pack has no name.' },
  { key: 'layers', description: 'No map layer is selected.' },
  { key: 'zoom', description: 'The zoom range is not whole numbers inside the limits, or min is above max.' },
  { key: 'too_large', description: 'The estimate is above the pack limits (the checker refuses it too).' },
] as const);
export type PackProblem = KeyOf<typeof PACK_PROBLEMS>;

/**
 * Why a pack is refused before it is sent: v3's three toasts (region, name, layer) in v3's order, then the two checks the
 * file schema adds (zoom range, size limit). The last two are also compile problems, so a draft can never hold them.
 */
export function packProblem(
  v: Omit<PackValues, 'bounds'> & { readonly bounds: Bounds | null },
  file: TemplateFile,
): PackProblem | null {
  if (v.bounds === null) return 'region';
  if (v.name.trim() === '') return 'name';
  if (v.layers.length === 0) return 'layers';
  const lo = packLimit('min_zoom');
  const hi = packLimit('max_zoom');
  const whole = Number.isInteger(v.minZoom) && Number.isInteger(v.maxZoom);
  if (!whole || v.minZoom < lo || v.maxZoom > hi || v.minZoom > v.maxZoom) return 'zoom';
  const est = estimateOf(file, { ...v, bounds: v.bounds });
  return est.tiles > packLimit('max_tiles') || est.bytes > packLimit('max_bytes') ? 'too_large' : null;
}

/** The box of two opposite corners ([lng, lat]), in `[west, south, east, north]` order whichever way it was drawn. */
export function rectBounds(a: readonly [number, number], b: readonly [number, number]): Bounds {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/** The smallest box around a drawn area (a pack is a box: v3's polygon mode keeps its meaning as that box). */
export function polygonBounds(points: readonly (readonly [number, number])[]): Bounds | null {
  const [first, ...rest] = points;
  if (first === undefined) return null;
  return rest.reduce<Bounds>(
    (box, p) => [
      Math.min(box[0], p[0]),
      Math.min(box[1], p[1]),
      Math.max(box[2], p[0]),
      Math.max(box[3], p[1]),
    ],
    [first[0], first[1], first[0], first[1]],
  );
}

const EARTH_RADIUS_KM = 6371.0088;

/** The area of a box on the sphere in km2 (v3 `calculatePolygonAreaKm2` over the box). */
export function boundsAreaKm2([w, s, e, n]: Bounds): number {
  const rad = Math.PI / 180;
  return EARTH_RADIUS_KM ** 2 * (e - w) * rad * (Math.sin(n * rad) - Math.sin(s * rad));
}

/** v3 `formatArea`. */
export function formatArea(areaKm2: number): string {
  if (areaKm2 < 0.01) return `${(areaKm2 * 1_000_000).toFixed(0)} m²`;
  if (areaKm2 < 1) return `${(areaKm2 * 100).toFixed(1)} ha`;
  if (areaKm2 < 100) return `${areaKm2.toFixed(2)} km²`;
  return `${areaKm2.toFixed(0)} km²`;
}

/** v3 `formatTileCount`. */
export function formatTileCount(count: number): string {
  if (count < 1000) return `~${count}`;
  if (count < 10000) return `~${(count / 1000).toFixed(1)}k`;
  return `~${Math.round(count / 1000)}k`;
}

/** v3 `formatFileSize`. */
export function formatBytes(bytes: number | undefined): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
