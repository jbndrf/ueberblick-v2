/**
 * The `maplibre-2d` style renderer: a MapLibre Style Spec fragment `{ layers: [...] }` (decision
 * 0014). The layer ids and source ids are the ones the ui map draws by default: a style layer
 * with a default's id replaces it. The controls edit the paint
 * values of those three layers; an expression value (`["get", ...]`) stays readable as "not fixed"
 * and is edited in the YAML lens. Validation and the ids are the ui's (`@ueberblick/ui/view-style`),
 * which loads the Style Spec on the first check only.
 */
import { LAYER_IDS, SOURCES, validateViewStyle } from '@ueberblick/ui/view-style';
import type { Json } from '@ueberblick/core';
import type { StyleControl, StyleIssue, StyleRenderer, StyleValue } from './renderers';

const { geometry: SOURCE_GEOMETRY, clusters: SOURCE_POINTS } = SOURCES;
const { single: POINT, line: LINE, fill: FILL } = LAYER_IDS;

type Layer = { readonly [key: string]: Json };

const isRecord = (v: unknown): v is { readonly [key: string]: Json } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function layersOf(style: StyleValue): readonly Layer[] {
  return Array.isArray(style.layers) ? style.layers.filter(isRecord) : [];
}

function defaultStyle(): StyleValue {
  return {
    layers: [
      {
        id: FILL,
        type: 'fill',
        source: SOURCE_GEOMETRY,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#2b6cb0', 'fill-opacity': 0.3 },
      },
      {
        id: LINE,
        type: 'line',
        source: SOURCE_GEOMETRY,
        paint: { 'line-color': '#2b6cb0', 'line-width': 3 },
      },
      {
        id: POINT,
        type: 'circle',
        source: SOURCE_POINTS,
        filter: ['!', ['has', 'clusterId']],
        paint: {
          'circle-color': '#2b6cb0',
          'circle-radius': 9,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      },
    ],
  };
}

function paint(layerId: string, property: string) {
  return {
    read(style: StyleValue): string | number | undefined {
      const layer = layersOf(style).find((l) => l.id === layerId);
      const value = isRecord(layer?.paint) ? layer.paint[property] : undefined;
      return typeof value === 'string' || typeof value === 'number' ? value : undefined;
    },
    write(style: StyleValue, value: string | number): StyleValue {
      const layers = layersOf(style);
      const withLayer = layers.some((l) => l.id === layerId)
        ? layers
        : [...layers, ...layersOf(defaultStyle()).filter((l) => l.id === layerId)];
      return {
        ...style,
        layers: withLayer.map((l) =>
          l.id === layerId
            ? { ...l, paint: { ...(isRecord(l.paint) ? l.paint : {}), [property]: value } }
            : l,
        ),
      };
    },
  };
}

const control = (
  key: string,
  kind: StyleControl['kind'],
  en: string,
  de: string,
  layerId: string,
  property: string,
  range: Pick<StyleControl, 'min' | 'max' | 'step'> = {},
): StyleControl => ({ key, kind, label: { en, de }, ...range, ...paint(layerId, property) });

const controls: readonly StyleControl[] = [
  control('point_color', 'color', 'Point colour', 'Punktfarbe', POINT, 'circle-color'),
  control('point_size', 'number', 'Point size (px)', 'Punktgröße (px)', POINT, 'circle-radius', {
    min: 1,
    max: 40,
    step: 1,
  }),
  control('line_color', 'color', 'Line colour', 'Linienfarbe', LINE, 'line-color'),
  control('line_width', 'number', 'Line width (px)', 'Linienbreite (px)', LINE, 'line-width', {
    min: 0.5,
    max: 20,
    step: 0.5,
  }),
  control('area_color', 'color', 'Area colour', 'Flächenfarbe', FILL, 'fill-color'),
  control(
    'area_opacity',
    'number',
    'Area opacity (0 to 1)',
    'Flächendeckkraft (0 bis 1)',
    FILL,
    'fill-opacity',
    { min: 0, max: 1, step: 0.05 },
  ),
];

async function validate(style: StyleValue): Promise<readonly StyleIssue[]> {
  const result = await validateViewStyle(style);
  if (result.ok) return [];
  return result.errors.map((e) =>
    e.layerId === undefined
      ? { message: e.path === '' ? e.message : `${e.path}: ${e.message}` }
      : { message: e.message, layerId: e.layerId },
  );
}

export const maplibre2d: StyleRenderer = {
  key: 'maplibre-2d',
  label: { en: 'Map (2D)', de: 'Karte (2D)' },
  defaultStyle,
  controls,
  validate,
};
