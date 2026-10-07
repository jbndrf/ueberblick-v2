// Where the participant map opens (WP-692). v3 opened at the project's start centre and zoom and never fitted to
// the features (`+page.svelte:646-666`, `MapCanvas.svelte:198-199`). In v4 the order is: the view's own camera, then
// the project's `map.start`, then the renderer's fit to the first features (the first build's behaviour, kept only
// as the fallback when no start is configured), then its default. WP-731: a view whose type has no geometry has
// nothing to fit, so without a start it opens where v3 opened without one (`DEFAULT_CAMERA`). The zoom is clamped by the renderer to the
// project's bounds (WP-690), so nothing here repeats that.
import type { MapConfig, View } from '@ueberblick/core/model';

export type MapStart = NonNullable<MapConfig['start']>;

/** v3's centre and zoom when a project set none (`MapCanvas.svelte:198-199`: `DEFAULT_CENTER`, `DEFAULT_XYZ_ZOOM`). */
export const DEFAULT_CAMERA = { center: [7.45, 51.505], zoom: 13 } as const;

/** Whether the view's type is drawn at a place; a type without a `geometry` property gives the map nothing to fit. */
export function viewHasLocations(
  view: View,
  types: Record<string, { readonly geometry?: string | undefined }> | undefined,
): boolean {
  return types?.[view.source.type]?.geometry !== undefined;
}

/**
 * `view` as the renderer should open it: without a camera of its own it gets `map.start`; without a start either, a
 * view that has no locations to fit gets v3's default camera (a view with locations is fitted by the renderer).
 */
export function withStartCamera(view: View, start: MapStart | undefined, hasLocations = true): View {
  if (view.camera !== undefined) return view;
  if (start === undefined)
    return hasLocations
      ? view
      : { ...view, camera: { center: [...DEFAULT_CAMERA.center], zoom: DEFAULT_CAMERA.zoom } };
  return {
    ...view,
    camera: { center: start.center, ...(start.zoom === undefined ? {} : { zoom: start.zoom }) },
  };
}
