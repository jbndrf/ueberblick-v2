/**
 * Puts the camera on a feature the person is about to move or redraw (v3 gives no zoom for it; the zoom is the one v4
 * already uses to focus a single feature, the Zuletzt fly-to, `RECENT_MIN_ZOOM`). It does nothing when the feature
 * is already comfortably in view: inside the middle of a street-level map.
 */
import type { Bbox, Position } from '@ueberblick/core/geo';
import type { MapHandle } from '@ueberblick/ui';
import { RECENT_MIN_ZOOM } from '../sheets/recent/fly';

/** A view wider than this (degrees of longitude, about 1.5 km) is not street level. */
export const STREET_SPAN_DEG = 0.02;
/** "Comfortably" means inside the middle part of the view: this share of each side's margin is kept free. */
const MARGIN = 0.25;

const inMiddle = (view: Bbox, box: Bbox): boolean => {
  const mx = (view[2] - view[0]) * MARGIN;
  const my = (view[3] - view[1]) * MARGIN;
  return box[0] >= view[0] + mx && box[2] <= view[2] - mx && box[1] >= view[1] + my && box[3] <= view[3] - my;
};

export function focusOn(handle: MapHandle, target: Position | Bbox): void {
  const view = handle.extent();
  const [x = 0, y = 0] = target;
  const box: Bbox = target.length === 4 ? (target as Bbox) : [x, y, x, y];
  if (view[2] - view[0] <= STREET_SPAN_DEG && inMiddle(view, box)) return;
  handle.centerOn(target, target.length === 4 ? {} : { minZoom: RECENT_MIN_ZOOM });
}
