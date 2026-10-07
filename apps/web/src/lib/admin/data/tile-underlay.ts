import { defaultSelection } from '@ueberblick/core/registry';
import type { TemplateFile } from '@ueberblick/core';
import { basemapSpecs } from '@ueberblick/ui';
import type { Box, Frame } from './geometry-svg';

export interface UnderlayTile {
  readonly src: string;
  readonly left: number;
  readonly top: number;
  readonly size: number;
}

/** The raster tiles of the project's base layer, for the Standort preview's underlay. */
export interface PreviewBasemap {
  /** `{z}/{x}/{y}` template. */
  readonly tiles: string;
  readonly tileSize: number;
  readonly maxzoom: number;
  readonly attribution?: string;
}

const MIN_ZOOM = 0;
const MAX_ZOOM = 19;

/**
 * The project's default base layer as one tile template, read by the kit's `basemapSpecs` (the one reader of layer
 * sources), or null when there is no map or the base is not a plain `{z}/{x}/{y}` raster (WMS, PMTiles and vector
 * bases show the shape alone). Pure; the layer the participant map starts on, read from `project`'s tile proxy.
 */
export function previewBasemap(map: TemplateFile['map'] | undefined, project: string): PreviewBasemap | null {
  if (map === undefined) return null;
  // The tiles come from the project's proxy (A-033): the admin's browser never asks a provider either. The URL is
  // relative, an <img> resolves it against the page.
  const spec = basemapSpecs(map, { base: defaultSelection(map).base, overlays: [] }, undefined, {
    project,
    origin: '',
  }).sources[0]?.spec as
    | { type?: string; tiles?: string[]; tileSize?: number; maxzoom?: number; attribution?: string }
    | undefined;
  const tiles = spec?.tiles?.[0];
  if (spec?.type !== 'raster' || tiles === undefined || !tiles.includes('{z}')) return null;
  return {
    tiles,
    tileSize: spec.tileSize ?? 256,
    maxzoom: spec.maxzoom ?? MAX_ZOOM,
    ...(spec.attribution === undefined ? {} : { attribution: spec.attribution }),
  };
}

/** The tiles that cover `box`, placed by the shape's `frame` (web mercator), so they lie under the drawn shape. Pure. */
export function underlayTiles(basemap: PreviewBasemap, frame: Frame, box: Box): UnderlayTile[] {
  const wanted = Math.floor(Math.log2(frame.scale / basemap.tileSize));
  const z = Math.max(MIN_ZOOM, Math.min(basemap.maxzoom, wanted));
  const n = 2 ** z;
  const size = frame.scale / n;
  const range = (from: number, to: number, origin: number): [number, number] => [
    Math.max(0, Math.floor((from - origin) / size)),
    Math.min(n - 1, Math.floor((to - origin) / size)),
  ];
  const [x0, x1] = range(0, box.width, frame.originX);
  const [y0, y1] = range(0, box.height, frame.originY);
  const out: UnderlayTile[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const src = basemap.tiles
        .replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y))
        .replace('{s}', 'a');
      out.push({ src, left: frame.originX + x * size, top: frame.originY + y * size, size });
    }
  }
  return out;
}
