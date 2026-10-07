// The project's zoom limits (`map.min_zoom`, `map.max_zoom`; v3 Projekteinstellungen, A-036). They go to MapLibre as
// `minZoom`/`maxZoom`, and every zoom the renderer itself asks for (fit, fly-to, zoom buttons, a view camera) is
// clamped to them, so nothing the renderer does leaves the bounds. Absent means MapLibre's own default.
import type { Bbox, Position } from '@ueberblick/core/geo';
import type { CenterOptions, ZoomBounds } from '../contract';
import { pointEase } from './camera';
import type { MlMap } from './api';

export interface ZoomLimits {
  set(next: ZoomBounds | undefined, map: MlMap | undefined): void;
  /** The Map constructor options for the limits that are set. */
  options(): { minZoom?: number; maxZoom?: number };
  /** `o` with its `zoom`, when it has one, inside the bounds. */
  within<T extends { zoom?: number }>(o: T): T;
  /** Fits a bbox (padding 40, to zoom 18 at most) or eases to a point, never leaving the bounds (v3 fly-to, `centerOn`). */
  centre(
    map: MlMap,
    target: Position | Bbox,
    opts: CenterOptions | undefined,
    jump: { duration?: number },
  ): void;
  /** The highest zoom a fit may reach: `wanted`, or the project's maximum when that is lower. */
  cap(wanted: number): number;
}

export function createZoomLimits(): ZoomLimits {
  let bounds: ZoomBounds | undefined;
  const clamp = (z: number): number =>
    Math.min(bounds?.max ?? Infinity, Math.max(bounds?.min ?? -Infinity, z));
  return {
    set(next, map) {
      bounds = next;
      map?.setMinZoom(next?.min ?? null);
      map?.setMaxZoom(next?.max ?? null);
    },
    options: () => ({
      ...(bounds?.min === undefined ? {} : { minZoom: bounds.min }),
      ...(bounds?.max === undefined ? {} : { maxZoom: bounds.max }),
    }),
    within: (o) => (o.zoom === undefined ? o : { ...o, zoom: clamp(o.zoom) }),
    centre(map, target, opts, jump) {
      if (target.length === 4) {
        const [w, s, e, n] = target;
        map.fitBounds(
          [
            [w, s],
            [e, n],
          ],
          { ...jump, padding: 40, maxZoom: Math.min(18, bounds?.max ?? 18) },
        );
      } else {
        map.easeTo({ ...this.within(pointEase([target[0], target[1]], opts, map.getZoom())), ...jump });
      }
    },
    cap: (wanted) => Math.min(wanted, bounds?.max ?? wanted),
  };
}
