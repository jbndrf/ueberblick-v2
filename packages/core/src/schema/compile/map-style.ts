/**
 * The `advanced` style of a map layer (WP-614, WP-621): checked at compile time through a port, because only
 * the ui can load the MapLibre Style Spec (core may not import it). The caller passes `basemapErrors` of
 * `@ueberblick/ui` bound to the Style Spec; without a checker, only the shape of the file is checked.
 */
import type { TemplateFile } from '../file';
import { kp } from './kp';
import type { Sink } from './problems';

/** One problem of one layer's `advanced` style; `layer` is the key in `map.layers`. */
export interface MapStyleError {
  readonly layer: string;
  readonly message: string;
}

/** Checks the map section of a file against the Style Spec; returns one error per problem. */
export type MapStyleChecker = (map: NonNullable<TemplateFile['map']>) => readonly MapStyleError[];

export function checkMapStyles(file: TemplateFile, check: MapStyleChecker | undefined, sink: Sink): void {
  if (file.map === undefined || check === undefined) return;
  for (const e of check(file.map)) {
    sink.error(
      kp('map', 'layers', e.layer, 'advanced'),
      'style_invalid',
      `layer '${e.layer}': ${e.message}`,
      'fix the advanced paint and layout of the layer so it fits the MapLibre Style Spec, see docs/05',
      { layer: e.layer, detail: e.message },
    );
  }
}
