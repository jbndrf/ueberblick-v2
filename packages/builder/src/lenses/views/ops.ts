/**
 * View and layer edits as WP-200 ops. No DOM: the lens, tests and assistants (H4) share them (R1).
 * `Doc.apply` decides between `override` and `add`; the lens sends `set` for "change this value".
 */
import type { Op } from '../../doc';
import type { ViewItem } from './model';

const viewPath = (view: string) => `views.${view}`;
const layerPath = (view: string, layer: string) => `views.${view}.layers.${layer}`;

export const setViewFilterOp = (view: string, filter: string): Op => ({
  kind: 'set',
  path: `${viewPath(view)}.source.filter`,
  value: filter,
});

/** Drops the filter: the view (or the layer) selects every feature of its type. */
export const removeFilterOp = (view: string, layer?: string): Op => ({
  kind: 'hide',
  path: `${layer === undefined ? viewPath(view) : layerPath(view, layer)}.source.filter`,
});

/** The layer's own source: a feature type with an optional filter. */
export const setLayerSourceOp = (
  view: string,
  layer: string,
  source: { readonly type: string; readonly filter?: string },
): Op => ({ kind: 'set', path: `${layerPath(view, layer)}.source`, value: source });

export const setLayerRendererOp = (view: string, layer: string, renderer: string): Op => ({
  kind: 'set',
  path: `${layerPath(view, layer)}.renderer`,
  value: renderer,
});

export const setLayerStyleOp = (view: string, layer: string, style: unknown): Op => ({
  kind: 'set',
  path: `${layerPath(view, layer)}.style`,
  value: style,
});

/** A view without `layers` gets the map with its first layer; one with layers gets a single entry. */
export const addLayerOp = (view: ViewItem, layer: string, renderer: string): Op =>
  view.layers.length === 0
    ? { kind: 'set', path: `${viewPath(view.key)}.layers`, value: { [layer]: { renderer } } }
    : { kind: 'add', path: layerPath(view.key, layer), value: { renderer } };

export const addViewOp = (key: string, type: string, label: string): Op => ({
  kind: 'add',
  path: viewPath(key),
  value: label === '' ? { source: { type } } : { label: { de: label, en: label }, source: { type } },
});
