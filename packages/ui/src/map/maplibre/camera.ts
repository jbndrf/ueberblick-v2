// The view camera (schema `Camera`, WP-010.2) in MapLibre's terms. A 3D renderer reads the same camera and uses Z directly.
import type { View } from '@ueberblick/core/model';
import type { CenterOptions } from '../contract';

type Camera = NonNullable<View['camera']>;

export interface MaplibreCamera {
  readonly center: [number, number];
  readonly zoom?: number;
  readonly bearing?: number;
  readonly pitch?: number;
}

/** Equator circumference in metres (Web Mercator, EPSG:3857). */
const EQUATOR_M = 40_075_016.686;
const MAX_ZOOM = 24;
/** A camera with neither zoom nor Z opens at town level (a map at zoom 0 would show the whole world). */
export const CAMERA_DEFAULT_ZOOM = 14;

/**
 * The zoom at which a map looks straight down from `z` metres above the ellipsoid at latitude `lat`.
 * MapLibre's camera (fov 2*atan(1/3)) sits 1.5 map heights above the ground, and a 512 px map height
 * spans 512 * EQUATOR_M * cos(lat) / (512 * 2^zoom) metres per 512 px tile, so
 * `zoom = log2(1.5 * EQUATOR_M * cos(lat) / z)`. Clamped to 0..24 (the schema's zoom range).
 */
export function zoomForHeight(z: number, lat: number): number {
  const zoom = Math.log2((1.5 * EQUATOR_M * Math.cos((lat * Math.PI) / 180)) / z);
  return Math.min(MAX_ZOOM, Math.max(0, zoom));
}

/** An explicit `zoom` wins; otherwise a positive Z gives the zoom; otherwise the zoom stays as it is. */
export function cameraToMaplibre(camera: Camera): MaplibreCamera {
  const [lon, lat, z] = camera.center;
  const zoom = camera.zoom ?? (z !== undefined && z > 0 ? zoomForHeight(z, lat as number) : undefined);
  return {
    center: [lon as number, lat as number],
    ...(zoom === undefined ? {} : { zoom }),
    ...(camera.bearing === undefined ? {} : { bearing: camera.bearing }),
    ...(camera.pitch === undefined ? {} : { pitch: camera.pitch }),
  };
}

/**
 * The `easeTo` options for centring on a point (`CenterOptions`): an absolute `zoom`, or `minZoom` (v3 fly-to: never
 * zooms out), and an `offset` that puts the point in the middle of what the sheets leave free (v3 `flyToWithOffset`:
 * half of the covered pixels, towards the top left).
 */
export function pointEase(
  center: [number, number],
  opts: CenterOptions | undefined,
  currentZoom: number,
): { center: [number, number]; zoom?: number; offset?: [number, number] } {
  const zoom = opts?.minZoom === undefined ? opts?.zoom : Math.max(currentZoom, opts.minZoom);
  const o = opts?.offset;
  return {
    center,
    ...(zoom === undefined ? {} : { zoom }),
    ...(o === undefined ? {} : { offset: [-(o.right ?? 0) / 2, -(o.bottom ?? 0) / 2] as [number, number] }),
  };
}
