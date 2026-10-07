/**
 * The look of a feature on the map (WP-674, B-018): the icons a marker may name by key, the icon size and the
 * limits of an inline SVG. The participant app draws exactly these keys
 * (`packages/ui/src/map/maplibre/marker-icon-bodies.ts`).
 */
import { defineRegistry, type KeyOf } from './define';

/** The icons `types.<t>.marker.icon` and `types.<t>.classify.values.<v>.icon` may name by `key`. */
export const MARKER_ICONS = defineRegistry([
  { key: 'camera', description: 'A photo.' },
  { key: 'check', description: 'Done.' },
  { key: 'circle-alert', description: 'A problem.' },
  { key: 'clipboard-check', description: 'An inspection.' },
  { key: 'flag', description: 'A mark.' },
  { key: 'house', description: 'A building.' },
  { key: 'info', description: 'Information.' },
  { key: 'leaf', description: 'Vegetation.' },
  { key: 'map-pin', description: 'A place.' },
  { key: 'pencil', description: 'Edited.' },
  { key: 'trash-2', description: 'Removed.' },
  { key: 'tree-deciduous', description: 'A tree.' },
  { key: 'triangle-alert', description: 'A defect or a warning.' },
  { key: 'wrench', description: 'Repair or maintenance.' },
] as const);
export type MarkerIcon = KeyOf<typeof MARKER_ICONS>;

/** Icon size in px (v3 designer input 8 to 128, default 32: `svg-icon-designer.svelte:75,327`, `map-icons.ts` `style.size || 32`). */
export const MARKER_ICON_SIZE = { default: 32, min: 8, max: 128 } as const;

/** The marker colour of a type that names none (v3 `DEFAULT_MARKER_COLOR`, `map-icons.ts:56`). */
export const DEFAULT_MARKER_COLOR = '#6366f1';

/** Limits of an inline SVG icon (v3 `svg-validator.ts:20` allowed 50 KB). Elements are an allowlist; attributes may not run script or load a file. */
export const SVG_ICON_LIMITS = {
  max_bytes: 50 * 1024,
  elements: [
    'svg',
    'g',
    'path',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
    'rect',
    'defs',
    'linearGradient',
    'radialGradient',
    'stop',
    'clipPath',
    'mask',
    'title',
    'desc',
  ],
} as const;
