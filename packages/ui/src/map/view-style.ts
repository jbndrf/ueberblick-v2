// View style validation and the default source/layer ids: the one definition the maplibre-2d
// renderer and the builder share (WP-570). Reached as `@ueberblick/ui/view-style`. It imports
// neither the MapLibre packages nor the ui barrel, and loads the Style Spec only when a check runs (R14).

/** The sources the renderer defines. A view style may reference only these. */
export const SOURCES = { clusters: 'ub-clusters', geometry: 'ub-geometry' } as const;

/** Ids of the default layers. A style layer with one of these ids replaces the default. */
export const LAYER_IDS = {
  fill: 'ub-shape-fill',
  line: 'ub-shape-line',
  single: 'ub-single',
  cluster: 'ub-cluster',
  count: 'ub-cluster-count',
  open: 'ub-family-open',
  openCount: 'ub-family-open-count',
} as const;

/** One problem in a view style. `path` is like `layers[2]`; `layerId` is set when a layer is at fault. */
export interface ViewStyleError {
  readonly path: string;
  readonly message: string;
  readonly layerId?: string;
}

/** Verdict of any renderer's style validator (renderer-neutral: H1 3D adds its own). */
export type ViewStyleResult =
  { readonly ok: true } | { readonly ok: false; readonly errors: readonly ViewStyleError[] };

/** The Style Spec's `validateStyleMin` and `isExpressionFilter`, as far as this module uses them. */
export interface StyleSpecValidator {
  readonly validate: (style: never) => readonly { readonly message: string }[];
  readonly isExpressionFilter: (filter: unknown) => boolean;
}

const SOURCE_IDS: readonly string[] = Object.values(SOURCES);
const DEFAULT_LAYER_IDS: readonly string[] = Object.values(LAYER_IDS);
const emptyData = { type: 'FeatureCollection', features: [] };
const sources = Object.fromEntries(SOURCE_IDS.map((id) => [id, { type: 'geojson', data: emptyData }]));

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function layerError(layer: unknown, index: number, spec: StyleSpecValidator): ViewStyleError | undefined {
  const path = `layers[${index}]`;
  if (!isRecord(layer) || typeof layer.id !== 'string') return { path, message: 'needs a string id' };
  const id = layer.id;
  if (typeof layer.source === 'string' && !SOURCE_IDS.includes(layer.source)) {
    return { path, layerId: id, message: `source "${layer.source}" is not one of ${SOURCE_IDS.join(', ')}` };
  }
  // The renderer combines an added layer's filter with an expression filter, and MapLibre refuses to
  // mix the two syntaxes, so a layer added over ub-clusters needs an expression filter.
  if (
    layer.source === SOURCES.clusters &&
    !DEFAULT_LAYER_IDS.includes(id) &&
    Array.isArray(layer.filter) &&
    !spec.isExpressionFilter(layer.filter)
  )
    return {
      path: `${path}.filter`,
      layerId: id,
      message:
        'filters on layers over ub-clusters must use expression syntax, e.g. ["==", ["get", "art"], "x"]',
    };
  // Validated alone so an error names its layer.
  const first = spec.validate({ version: 8, sources, layers: [layer] } as never)[0];
  return first === undefined ? undefined : { path, layerId: id, message: first.message };
}

/**
 * The problems of one view style fragment (`{ layers: [...] }`), given the Style Spec validator.
 * Synchronous so the renderer, which has the spec loaded, and `validateViewStyle` share it.
 */
export function viewStyleErrors(style: unknown, spec: StyleSpecValidator): readonly ViewStyleError[] {
  if (!isRecord(style) || '$ref' in style) {
    return [{ path: '', message: 'style must be resolved before it reaches the map ($ref found)' }];
  }
  if (!Array.isArray(style.layers)) return [{ path: 'layers', message: 'style.layers must be a list' }];
  const errors: ViewStyleError[] = [];
  style.layers.forEach((layer, i) => {
    const e = layerError(layer, i, spec);
    if (e !== undefined) errors.push(e);
  });
  return errors;
}

/** Validate a maplibre-2d view style. Loads the Style Spec on first call, not before. */
export async function validateViewStyle(style: unknown): Promise<ViewStyleResult> {
  const { isExpressionFilter, validateStyleMin } = await import('./maplibre/style-spec');
  const errors = viewStyleErrors(style, { validate: validateStyleMin, isExpressionFilter });
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
