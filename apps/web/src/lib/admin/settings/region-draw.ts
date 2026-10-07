/**
 * The drawing of a pack's region on the map (v3 `components/map/region-selector.svelte`), as plain state. v3 dragged a
 * rectangle and double-clicked a polygon closed; a drag pans the map on a phone and a double tap zooms it, so here two
 * taps (two opposite corners) make the rectangle and a "Fertig" button closes the polygon. A pack is a box (`map.packs`
 * `bounds`), so a polygon keeps its meaning as the box around it, which is what is shown and what is saved.
 */
import type { Bounds } from '@ueberblick/core/geo';
import { polygonBounds, rectBounds } from './packs';

export type DrawMode = 'rectangle' | 'polygon';
export type LngLat = readonly [number, number];

export interface RegionDraft {
  readonly mode: DrawMode;
  /** Rectangle: the first corner, until the second tap. */
  readonly corner: LngLat | null;
  /** Polygon: the vertices so far. */
  readonly vertices: readonly LngLat[];
  /** The finished region; while set, nothing else is drawn (v3: the mode buttons are disabled). */
  readonly region: Bounds | null;
}

export const startDraft = (region: Bounds | null = null): RegionDraft => ({
  mode: 'rectangle',
  corner: null,
  vertices: [],
  region,
});

/** v3 `switchMode`: refused once a region is drawn; it drops what was started. */
export function setMode(d: RegionDraft, mode: DrawMode): RegionDraft {
  return d.region === null ? { ...d, mode, corner: null, vertices: [] } : d;
}

/** A tap on the map. */
export function tap(d: RegionDraft, at: LngLat): RegionDraft {
  if (d.region !== null) return d;
  if (d.mode === 'polygon') return { ...d, vertices: [...d.vertices, at] };
  if (d.corner === null) return { ...d, corner: at };
  const region = rectBounds(d.corner, at);
  // two taps on one spot are no region (v3: "just a click, not a drag")
  return region[0] === region[2] || region[1] === region[3]
    ? { ...d, corner: null }
    : { ...d, corner: null, region };
}

/** v3's double-click: three vertices at least close the area; the region is the box around them. */
export function finishPolygon(d: RegionDraft): RegionDraft {
  if (d.region !== null || d.mode !== 'polygon' || d.vertices.length < 3) return d;
  return { ...d, vertices: [], region: polygonBounds(d.vertices) };
}

export const canFinish = (d: RegionDraft): boolean =>
  d.region === null && d.mode === 'polygon' && d.vertices.length >= 3;

/** v3 "Löschen" (clear). */
export const clearDraft = (d: RegionDraft): RegionDraft => ({
  ...d,
  corner: null,
  vertices: [],
  region: null,
});

/** What to draw for the draft: the box (final or the one following the pointer) or the vertices so far. */
export type Drawn =
  | { readonly kind: 'box'; readonly bounds: Bounds; readonly final: boolean }
  | { readonly kind: 'path'; readonly points: readonly LngLat[] }
  | null;

export function drawn(d: RegionDraft, hover: LngLat | null): Drawn {
  if (d.region !== null) return { kind: 'box', bounds: d.region, final: true };
  if (d.mode === 'rectangle') {
    return d.corner !== null && hover !== null
      ? { kind: 'box', bounds: rectBounds(d.corner, hover), final: false }
      : null;
  }
  const points = hover !== null && d.vertices.length > 0 ? [...d.vertices, hover] : d.vertices;
  return points.length > 0 ? { kind: 'path', points } : null;
}

/** The ring of a box, closed, as a GeoJSON polygon (what the map handle's overlay takes). */
export function boxRing([w, s, e, n]: Bounds): [number, number][] {
  return [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ];
}
