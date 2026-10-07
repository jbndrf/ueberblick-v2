/** Reads the geometry of one Objekt from its OGC item and lays it out on the base layer's tiles (the table's hover card and the detail page's Standort pane share this). */
import { previewShape, type Box, type PreviewShape } from './geometry-svg';
import { underlayTiles, type PreviewBasemap, type UnderlayTile } from './tile-underlay';

export interface LoadedShape {
  readonly shape: PreviewShape;
  readonly tiles: readonly UnderlayTile[];
}

/** The drawn shape of an Objekt, or null when it has none or cannot be read. */
export async function loadShape(
  project: string,
  type: string,
  id: string,
  box: Box,
  basemap: PreviewBasemap | null,
  doFetch: typeof fetch = fetch,
): Promise<LoadedShape | null> {
  try {
    const url = `/api/p/${encodeURIComponent(project)}/ogc/collections/${encodeURIComponent(type)}/items/${encodeURIComponent(id)}`;
    const res = await doFetch(url, { headers: { accept: 'application/geo+json, application/json' } });
    if (!res.ok) return null;
    const item = (await res.json()) as { geometry?: unknown };
    const shape = previewShape(item.geometry, box);
    return shape === null
      ? null
      : { shape, tiles: basemap === null ? [] : underlayTiles(basemap, shape.frame, box) };
  } catch {
    return null;
  }
}
