// A type's look by value, compiled to the MapLibre Style Spec (WP-674, B-018): `icon-image` by a `match` on the
// classifying property's value, the colour of shapes by a `match`, and the list of images that `icon-image` names.
// Pure: no MapLibre, no DOM. v3 drew every marker as one symbol layer of registered images (`map-icons.ts:1-14`).
import type { MarkerLooks, ResolvedMarker } from '@ueberblick/core/marker';
import { markerSvg } from '../marker-svg';
import { LAYER_IDS, SOURCES, type LayerDef } from './layers';

/** One image to register: the id the layer names, the svg to rasterise and the size it is drawn at. */
export interface LookImage {
  readonly id: string;
  readonly svg: string;
  /** Drawn size in CSS px; the image is rasterised at twice that and registered with pixelRatio 2. */
  readonly px: number;
}

export interface LookPlan {
  readonly images: readonly LookImage[];
  /** The `icon-image` value: an image id, or a `match` on the property. */
  readonly iconImage: unknown;
  /** The fill and line colour of shapes: a colour, or a `match` on the property. */
  readonly color: unknown;
}

const IMAGE_PREFIX = 'ub-look-';

/** FNV-1a of the drawing: the same drawing keeps its id across plans, a changed one gets a new id (WP-744). */
function imageId(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return `${IMAGE_PREFIX}${(h >>> 0).toString(36)}-${key.length.toString(36)}`;
}

/** Every distinct drawing becomes one image (v3 interned an icon by its svg and style, `map-icons.ts:186-199`). */
export function planLooks(looks: MarkerLooks): LookPlan {
  const images = new Map<string, LookImage>();
  const idOf = (look: ResolvedMarker): string => {
    const svg = markerSvg(look);
    const px = look.icon === undefined ? 24 : look.size;
    const key = `${px}|${svg}`;
    let image = images.get(key);
    if (image === undefined) {
      image = { id: imageId(key), svg, px };
      images.set(key, image);
    }
    return image.id;
  };
  const fallbackImage = idOf(looks.fallback);
  const entries = Object.entries(looks.values);
  const byValue = (pick: (look: ResolvedMarker) => string, fallback: string): unknown => {
    if (looks.property === undefined || entries.length === 0) return fallback;
    const arms = entries.flatMap(([value, look]) => [value, pick(look)]);
    return ['match', ['get', looks.property], ...arms, fallback];
  };
  const iconImage = byValue(idOf, fallbackImage); // registers the images of the values before they are listed
  const color = byValue((look) => look.color, looks.fallback.color);
  return { images: [...images.values()], iconImage, color };
}

/**
 * The default layers drawn by value: `ub-single` becomes a symbol layer of the plan's images, and the fill and line
 * of shapes take the plan's colour (v3 `instance-geometry-layer.svelte:42`). A layer in `styled` is the view style's
 * own and stays as it is.
 */
export function lookLayers(
  layers: readonly LayerDef[],
  styled: ReadonlySet<string>,
  plan: LookPlan,
): LayerDef[] {
  return layers.map((def): LayerDef => {
    const spec = def.spec as { id: string; paint?: Record<string, unknown> };
    if (styled.has(spec.id)) return def;
    if (spec.id === LAYER_IDS.single) {
      return {
        ...def,
        spec: {
          id: spec.id,
          type: 'symbol',
          source: SOURCES.clusters,
          filter: ['!', ['has', 'clusterId']],
          layout: { 'icon-image': plan.iconImage, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
        },
      };
    }
    if (spec.id === LAYER_IDS.fill)
      return { ...def, spec: { ...spec, paint: { ...spec.paint, 'fill-color': plan.color } } };
    if (spec.id === LAYER_IDS.line)
      return { ...def, spec: { ...spec, paint: { ...spec.paint, 'line-color': plan.color } } };
    return def;
  });
}
