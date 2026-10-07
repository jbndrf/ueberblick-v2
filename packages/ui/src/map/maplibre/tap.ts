// One tap, one target (WP-688). v3 hit-tested the markers first and then the line and fill layers, each with a
// touch tolerance (`MapCanvas.svelte:634-670` `hitTest` with `HIT_PAD_PX`; `instance-geometry-layer.svelte:86-97`
// `[L_LINE, L_FILL]`, skipped when `wasFeatureTap`). v4 asks MapLibre once and picks by class here.

/** v3's touch tolerance in px around a tap (`MapCanvas.svelte` `HIT_PAD_PX`). */
export const HIT_PAD_PX = 12;

/** The classes of a hit, in priority order: a point (or cluster), then a line, then an area. */
export const HIT_CLASSES = ['point', 'line', 'area'] as const;
export type HitClass = (typeof HIT_CLASSES)[number];

/** A feature MapLibre reports under the tap, topmost first; `layer.id` names the layer that drew it. */
export interface RenderedHit {
  readonly layer?: { readonly id: string };
  readonly properties?: { readonly [key: string]: unknown } | null;
  readonly geometry?: { readonly type: string; readonly coordinates?: unknown };
}

/** The class a layer of this MapLibre type belongs to (circle and symbol draw points; fill draws areas). */
export function classOfLayerType(type: unknown): HitClass {
  if (type === 'line') return 'line';
  if (type === 'fill' || type === 'fill-extrusion') return 'area';
  return 'point';
}

/** The pixel box around a tap that is hit-tested. */
export function tapBox(point: {
  readonly x: number;
  readonly y: number;
}): [[number, number], [number, number]] {
  return [
    [point.x - HIT_PAD_PX, point.y - HIT_PAD_PX],
    [point.x + HIT_PAD_PX, point.y + HIT_PAD_PX],
  ];
}

/**
 * The target of a tap: the topmost hit of the first class that has one (point, then line, then area).
 * One pass over the hits under the tap: O(hits), never O(features on the map).
 */
export function pickHit(
  hits: readonly RenderedHit[],
  classes: ReadonlyMap<string, HitClass>,
): RenderedHit | undefined {
  let best: RenderedHit | undefined;
  let bestRank: number = HIT_CLASSES.length;
  for (const hit of hits) {
    const cls = hit.layer === undefined ? undefined : classes.get(hit.layer.id);
    if (cls === undefined) continue;
    const rank = HIT_CLASSES.indexOf(cls);
    if (rank === 0) return hit;
    if (rank < bestRank) {
      best = hit;
      bestRank = rank;
    }
  }
  return best;
}
