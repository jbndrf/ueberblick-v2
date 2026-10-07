// A view layer's `style` (MapLibre Style Spec fragment, decision 0014) applied over the default
// layers. The fragment is `{ layers: [...] }`; a layer with a default's id replaces it, any other
// id is added below the look layers and draws single features only. It may reference only
// the sources defined in `layers.ts`. `$ref` styles are resolved by the caller before mounting.
import { isExpressionFilter, validateStyleMin } from './style-spec';
import type { View } from '@ueberblick/core/model';
import { viewStyleErrors } from '../view-style';
import { LAYERS, LAYER_IDS, SOURCES, type LayerDef } from './layers';
import { lookLayers } from './looks';
import type { LookPlan } from './looks';

/** A view style is invalid. `layerId` is set when one layer is at fault. */
export class MapStyleError extends Error {
  readonly layerId: string | undefined;
  constructor(message: string, layerId?: string) {
    super(layerId === undefined ? message : `Layer "${layerId}": ${message}`);
    this.name = 'MapStyleError';
    this.layerId = layerId;
  }
}

const RENDERER = 'maplibre-2d';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The layers to draw for a view: defaults with the view's maplibre-2d styles applied. With a `plan` (the type's look
 * by value, WP-674) the default single-feature and shape layers draw by value; a default the view's style replaces
 * stays as the style has it.
 */
export function resolveLayers(view: View, plan?: LookPlan): readonly LayerDef[] {
  const styles = Object.values(view.layers ?? {})
    .filter((l) => l.renderer === RENDERER && l.style !== undefined)
    .map((l) => l.style);
  if (styles.length === 0) return plan === undefined ? LAYERS : lookLayers(LAYERS, new Set(), plan);
  const replacements = new Map<string, unknown>();
  for (const style of styles) {
    const first = viewStyleErrors(style, { validate: validateStyleMin, isExpressionFilter })[0];
    if (first !== undefined)
      throw new MapStyleError(
        first.layerId === undefined && first.path.startsWith('layers[')
          ? `${first.path} ${first.message}`
          : first.message,
        first.layerId,
      );
    for (const layer of (style as { layers: { id: string }[] }).layers) replacements.set(layer.id, layer);
  }
  const defaultIds = new Set(LAYERS.map((d) => (d.spec as { id: string }).id));
  const replacedByStyle = LAYERS.map((d): LayerDef => {
    const spec = replacements.get((d.spec as { id: string }).id);
    return spec === undefined ? d : { ...d, spec };
  });
  const replaced =
    plan === undefined ? replacedByStyle : lookLayers(replacedByStyle, new Set(replacements.keys()), plan);
  const added = [...replacements]
    .filter(([id]) => !defaultIds.has(id))
    .map(([, spec]): LayerDef => ({ spec: singlesOnly(spec) }));
  // Added layers sit below the look layers (WP-759, B-024: looks are the only feature style, so nothing a view adds
  // may tint or cover a feature); cluster circles and counts are drawn last so nothing covers the counts.
  const isClusterPair = (d: LayerDef): boolean => CLUSTER_PAIR.includes((d.spec as { id: string }).id);
  // The renderer declares every source before the first layer, so a layer may come before the def that declares it.
  return [...added, ...replaced.filter((d) => !isClusterPair(d)), ...replaced.filter(isClusterPair)];
}

const CLUSTER_PAIR: readonly string[] = [LAYER_IDS.cluster, LAYER_IDS.count];
const NOT_CLUSTER = ['!', ['has', 'clusterId']];

/** A view-added layer on the point source draws single features only (never the cluster anchors). */
function singlesOnly(spec: unknown): unknown {
  if (!isRecord(spec) || spec.source !== SOURCES.clusters) return spec;
  return { ...spec, filter: spec.filter === undefined ? NOT_CLUSTER : ['all', spec.filter, NOT_CLUSTER] };
}

const CLUSTER_KEYS: readonly string[] = ['featureId', 'clusterId', 'count'];

function collectKeys(node: unknown, into: Set<string>): void {
  if (!Array.isArray(node)) {
    if (isRecord(node)) for (const v of Object.values(node)) collectKeys(v, into);
    return;
  }
  if ((node[0] === 'get' || node[0] === 'has') && typeof node[1] === 'string' && node.length === 2) {
    if (!CLUSTER_KEYS.includes(node[1])) into.add(node[1]);
  }
  for (const v of node) collectKeys(v, into);
}

/** Feature property keys the layers on the point source read (`["get", key]`, `["has", key]`). */
export function pointPropertyKeys(layers: readonly LayerDef[]): string[] {
  const keys = new Set<string>();
  for (const { spec } of layers) {
    if (isRecord(spec) && spec.source === SOURCES.clusters) collectKeys(spec, keys);
  }
  return [...keys];
}
