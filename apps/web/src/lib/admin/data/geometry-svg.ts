/**
 * The shape of a GeoJSON geometry as SVG paths in a box (the preview of the data page's Standort column). Pure.
 * Drawn in web mercator so that the project's basemap tiles lie exactly under it (`tile-underlay.ts`).
 */
type Pos = readonly [number, number];

export interface Box {
  readonly width: number;
  readonly height: number;
  readonly pad: number;
}
export interface PreviewShape {
  /** Open lines: `M x y L x y …`. */
  readonly paths: readonly string[];
  /** Closed rings: `M … Z`. */
  readonly areas: readonly string[];
  readonly points: readonly (readonly [number, number])[];
  /** The map frame of the box, for the tile underlay (`tile-underlay.ts`). */
  readonly frame: Frame;
}

interface Parts {
  lines: Pos[][];
  rings: Pos[][];
  points: Pos[];
}

const isPos = (v: unknown): v is Pos =>
  Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number';
const positions = (v: unknown): Pos[] => (Array.isArray(v) ? v.filter(isPos) : []);
const each = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function collect(g: { type?: unknown; coordinates?: unknown }, out: Parts): void {
  const c = g.coordinates;
  switch (g.type) {
    case 'Point':
      if (isPos(c)) out.points.push(c);
      break;
    case 'MultiPoint':
      out.points.push(...positions(c));
      break;
    case 'LineString':
      out.lines.push(positions(c));
      break;
    case 'MultiLineString':
      for (const l of each(c)) out.lines.push(positions(l));
      break;
    case 'Polygon':
      for (const r of each(c)) out.rings.push(positions(r));
      break;
    case 'MultiPolygon':
      for (const p of each(c)) for (const r of each(p)) out.rings.push(positions(r));
      break;
    default:
  }
}

/** Where the web-mercator world sits in the box: pixel of the world's top-left corner and pixels per world width. */
export interface Frame {
  readonly originX: number;
  readonly originY: number;
  readonly scale: number;
}

/** The deepest zoom a one-point shape is shown at (a point has no extent to fit). */
export const PREVIEW_MAX_ZOOM = 18;
const TILE = 256;

const mercX = (lon: number): number => (lon + 180) / 360;
const mercY = (lat: number): number => {
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

/**
 * The geometry fitted into `box`, or null when it holds nothing to draw. The shape is drawn in web mercator, so a
 * tile layer placed with `frame` lies exactly under it (the same projection the project's map uses).
 */
export function previewShape(geometry: unknown, box: Box): PreviewShape | null {
  if (geometry === null || typeof geometry !== 'object') return null;
  const parts: Parts = { lines: [], rings: [], points: [] };
  collect(geometry as { type?: unknown; coordinates?: unknown }, parts);
  const all = [...parts.lines.flat(), ...parts.rings.flat(), ...parts.points];
  if (all.length === 0) return null;

  const xs = all.map((p) => mercX(p[0]));
  const ys = all.map((p) => mercY(p[1]));
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = maxX - minX;
  const h = maxY - minY;
  const room = { w: box.width - 2 * box.pad, h: box.height - 2 * box.pad };
  const fit = Math.min(w === 0 ? Infinity : room.w / w, h === 0 ? Infinity : room.h / h);
  const scale = Math.min(fit, TILE * 2 ** PREVIEW_MAX_ZOOM);
  const originX = (box.width - w * scale) / 2 - minX * scale;
  const originY = (box.height - h * scale) / 2 - minY * scale;
  const at = (p: Pos): [number, number] => [
    Math.round((originX + mercX(p[0]) * scale) * 100) / 100,
    Math.round((originY + mercY(p[1]) * scale) * 100) / 100,
  ];
  const d = (ps: Pos[]): string => ps.map((p, i) => `${i === 0 ? 'M' : 'L'} ${at(p).join(' ')}`).join(' ');

  return {
    paths: parts.lines.filter((l) => l.length > 1).map(d),
    areas: parts.rings.filter((r) => r.length > 2).map((r) => `${d(r)} Z`),
    points: parts.points.map(at),
    frame: { originX, originY, scale },
  };
}
