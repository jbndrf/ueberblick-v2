/** The tiles of a pack in PMTiles order: ascending tile id, zoom by zoom, along the Hilbert curve. */
import { tileRanges, type Bounds } from '@ueberblick/core';
import { zxyToTileId } from 'pmtiles';

/** The tile ids of the bounds from `minZoom` to `maxZoom`, ascending. */
export function packTileIds(bounds: Bounds, minZoom: number, maxZoom: number): number[] {
  const ids: number[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const { x, y } = tileRanges(bounds, z);
    const level: number[] = [];
    for (let i = x[0]; i <= x[1]; i++) for (let j = y[0]; j <= y[1]; j++) level.push(zxyToTileId(z, i, j));
    level.sort((a, b) => a - b);
    for (const id of level) ids.push(id);
  }
  return ids;
}
