/**
 * What the map is given for one view, and the tool port it offers.
 *
 * INTERIM (WP-550, until WP-577 resolves `$ref` at compile time): a layer style may be `{ $ref: <path> }`, a style
 * file that nothing in the platform resolves yet. Such a layer is NOT drawn (R11: no silent default style); the caller
 * reports each one as a `style_unresolved` problem with the layer key.
 */
import type { View } from '@ueberblick/core/model';
import type { MapHandle, OverlayStyle } from '@ueberblick/ui';
import type { ToolMapPort } from '@ueberblick/ui/tool-api';

export interface DrawableView {
  /** The view without the layers that cannot be drawn. */
  readonly view: View;
  readonly unresolved: readonly { readonly layer: string; readonly ref: string }[];
  /** False when the view has layers and none of them can be drawn: the map is not mounted. */
  readonly drawable: boolean;
}

export function drawableView(view: View): DrawableView {
  if (view.layers === undefined) return { view, unresolved: [], drawable: true };
  const kept: [string, NonNullable<View['layers']>[string]][] = [];
  const unresolved: { layer: string; ref: string }[] = [];
  for (const [key, layer] of Object.entries(view.layers)) {
    if (layer.style !== undefined && '$ref' in layer.style)
      unresolved.push({ layer: key, ref: String(layer.style.$ref) });
    else kept.push([key, layer]);
  }
  if (unresolved.length === 0) return { view, unresolved, drawable: true };
  return {
    view: { ...view, layers: Object.fromEntries(kept) } as View,
    unresolved,
    drawable: kept.length > 0,
  };
}

/** The one overlay a toolbar tool shows (a measured line or area); a new one replaces it. */
const TOOL_OVERLAY = 'tool';

export interface MapToolPort {
  readonly port: ToolMapPort;
  /** A live map reports taps by position (needed by Measure); false while there is none (list only, or not up yet). */
  readonly canTap: boolean;
}

const noop = (): void => undefined;

/**
 * The tool port over the map handle (WP-576). `style` is the overlay's look, from the role's theme tokens. Without a
 * map (none mounted yet, or the list stands in for it) the port does nothing and Measure is not offered.
 */
export function mapToolPort(handle: MapHandle | undefined, style: OverlayStyle): MapToolPort {
  if (handle === undefined)
    return {
      canTap: false,
      port: { onTap: () => noop, centerOn: noop, showOverlay: noop, clearOverlay: noop },
    };
  return {
    canTap: true,
    port: {
      onTap: (fn) => handle.onMapTap(fn),
      centerOn: (p, zoom) => handle.centerOn(p, zoom === undefined ? undefined : { zoom }),
      showOverlay: (g) => handle.showOverlay(TOOL_OVERLAY, g, style),
      clearOverlay: () => handle.clearOverlay(TOOL_OVERLAY),
    },
  };
}

/** The handle tools may use: none while the list is the view (the map stays mounted but hidden and cannot be tapped). */
export function tappableHandle(handle: MapHandle | undefined, listShown: boolean): MapHandle | undefined {
  return listShown ? undefined : handle;
}

/** [lon, lat] of the middle of the map, or undefined while the map does not know its extent (the whole world). */
export function centerOfExtent(handle: MapHandle | undefined): readonly [number, number] | undefined {
  if (handle === undefined) return undefined;
  const [w, s, e, n] = handle.extent();
  if (e - w >= 360 || n - s >= 180) return undefined;
  return [(w + e) / 2, (s + n) / 2];
}
