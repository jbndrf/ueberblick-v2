// What the measure tool computes. Pure: every number comes from core.geo (`derive`, `distanceM`, `validate`),
// so a measured value agrees with the one the fold stores for a feature (R1). DOM-free, tested without a browser.
import type { Geo, Geometry, Position, ValidityReport } from '@ueberblick/core/geo';

/** What the user measures: the length of a path, or the area of an outline. */
export const MEASURE_MODES = { distance: 'distance', area: 'area' } as const;
export type MeasureMode = keyof typeof MEASURE_MODES;

export type Measurement =
  | { readonly state: 'empty' }
  | { readonly state: 'refused'; readonly issues: ValidityReport['issues'] }
  | { readonly state: 'ok'; readonly mode: 'distance'; readonly lengthM: number; readonly lastLegM: number }
  | { readonly state: 'ok'; readonly mode: 'area'; readonly areaM2: number; readonly perimeterM: number };

/** The fewest points that measure something. */
export const MIN_POINTS: Record<MeasureMode, number> = { distance: 2, area: 3 };

const point = (p: Position): Geometry => ({ type: 'Point', coordinates: p });

/** The closed outline of an area: RFC 7946 winding is core.geo's (`normalise`), not the user's concern. */
function outline(geo: Geo, points: readonly Position[]): Geometry {
  const first = points[0];
  if (!first) throw new Error('measure: no points');
  return geo.normalise({ type: 'Polygon', coordinates: [[...points, first]] });
}

export function measure(geo: Geo, mode: MeasureMode, points: readonly Position[]): Measurement {
  if (points.length < MIN_POINTS[mode]) return { state: 'empty' };
  if (mode === 'distance') {
    const a = points[points.length - 2];
    const b = points[points.length - 1];
    if (!a || !b) return { state: 'empty' };
    const line: Geometry = { type: 'LineString', coordinates: [...points] };
    return {
      state: 'ok',
      mode,
      lengthM: geo.derive(line).lengthM,
      lastLegM: geo.distanceM(point(a), point(b)),
    };
  }
  const area = outline(geo, points);
  const report = geo.validate(area);
  if (!report.valid) return { state: 'refused', issues: report.issues };
  const d = geo.derive(area);
  return { state: 'ok', mode, areaM2: d.areaM2, perimeterM: d.lengthM };
}

/** The temporary geometry shown on the map while measuring; `undefined` before the first point. */
export function overlayOf(mode: MeasureMode, points: readonly Position[]): Geometry | undefined {
  const first = points[0];
  if (!first) return undefined;
  if (points.length === 1) return point(first);
  if (mode === 'distance' || points.length === 2) return { type: 'LineString', coordinates: [...points] };
  return { type: 'Polygon', coordinates: [[...points, first]] };
}

const num = (locale: string, n: number, digits: number): string =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

/** Metric only: metres below a kilometre, then kilometres. */
export function formatLength(locale: string, m: number): string {
  return m < 1000 ? `${num(locale, m, 1)} m` : `${num(locale, m / 1000, 2)} km`;
}

/** Metric only: m² below one hectare, hectares below one km², then km². */
export function formatArea(locale: string, m2: number): string {
  if (m2 < 10_000) return `${num(locale, m2, 0)} m²`;
  if (m2 < 1_000_000) return `${num(locale, m2 / 10_000, 2)} ha`;
  return `${num(locale, m2 / 1_000_000, 2)} km²`;
}
