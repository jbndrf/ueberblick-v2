// Standort's accuracy circle (v3 `user-location.ts`): a circle in true metres, so it scales with the zoom. MapLibre's
// circle radius is in px; between two zooms an exponential-2 interpolation is exact (a pixel is half the metres per
// zoom step), so the radius at zoom 0 and at the top zoom, interpolated by zoom, is right at every zoom.

/** Metres per pixel at MapLibre zoom 0 on the equator (512 px world). */
const METRES_PER_PIXEL_Z0 = 78271.517;
export const ACCURACY_MAX_ZOOM = 22;

/** The px radius of a circle of `metres` at latitude `lat`, at zoom 0 and at `ACCURACY_MAX_ZOOM`. */
export function accuracyRadii(metres: number, lat: number): { r0: number; rMax: number } {
  const r0 = metres / (METRES_PER_PIXEL_Z0 * Math.cos((lat * Math.PI) / 180));
  return { r0, rMax: r0 * 2 ** ACCURACY_MAX_ZOOM };
}

/** The circle layer over `source`: only features that carry radii; v3's 10 % fill and 60 % stroke, 1 px. */
export function accuracyLayer(id: string, source: string): unknown {
  return {
    id,
    type: 'circle',
    source,
    filter: ['has', 'r0'],
    paint: {
      'circle-radius': [
        'interpolate',
        ['exponential', 2],
        ['zoom'],
        0,
        ['get', 'r0'],
        ACCURACY_MAX_ZOOM,
        ['get', 'rMax'],
      ],
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.1,
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': 1,
      'circle-stroke-opacity': 0.6,
    },
  };
}
