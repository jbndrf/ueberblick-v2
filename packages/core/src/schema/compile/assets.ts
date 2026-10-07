/**
 * Asset resolution (WP-577): a `{ $ref }` in a layer `style` names a file of the project bundle. compile()
 * embeds the resolved JSON so the compiled config, which is what a device downloads, never holds a `$ref`.
 * The resolver is a port: compile does no I/O (R2); the caller reads its bundle (template plus overlay files).
 * The seam is `AssetResolver`, not a style special case: a 3D model asset (H1) or an external GIS source (H5)
 * is one more slot with its own shape check, resolved through the same port.
 */
import { RENDERERS } from '../../registry';
import type { TemplateFile } from '../file';
import type { z } from 'zod';
import type { LayerSchema } from '../view';
import { kp } from './kp';
import type { RefResolver } from './embed-refs';
import type { Sink } from './problems';

/** Looks up one bundle file by the path a `$ref` names; `undefined` when the bundle does not hold it. */
export type AssetResolver = RefResolver;

/**
 * The resolver for files that are already self-contained (a stored or exchanged file, B-013): it holds no
 * bundle, so any `$ref` is refused as `asset_unresolved`. compile() has no default resolver (R11).
 */
export const NO_ASSETS: AssetResolver = () => undefined;

/** What one resolved asset must look like; returns one message per problem. */
type AssetShape = (json: unknown) => readonly string[];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Structural check of a maplibre-2d layer style: `{ layers: [{ id, ... }] }`. Core cannot load the Style
 * Spec (it may not import ui, and the device path stays light); the Style Spec check stays in the builder
 * (`validateViewStyle`, `@ueberblick/ui/view-style`).
 */
const maplibreStyle: AssetShape = (json) => {
  if (!isRecord(json)) return ['the style must be a JSON object'];
  if ('$ref' in json) return ['the style file is itself a $ref'];
  if (!Array.isArray(json.layers)) return ['`layers` must be a list'];
  const out: string[] = [];
  json.layers.forEach((l, i) => {
    if (!isRecord(l) || typeof l.id !== 'string' || l.id === '') out.push(`layers[${i}] needs a string id`);
  });
  return out;
};

const anyObject: AssetShape = (json) => (isRecord(json) ? [] : ['the style must be a JSON object']);

/** The shape check per renderer key. A renderer without an entry accepts any JSON object. */
const STYLE_SHAPES: Readonly<Record<string, AssetShape>> = { 'maplibre-2d': maplibreStyle };

const isRef = (style: NonNullable<Layer['style']>): style is { $ref: string } =>
  typeof (style as { $ref?: unknown }).$ref === 'string';

type Layer = z.infer<typeof LayerSchema>;
type View = NonNullable<TemplateFile['views']>[string];

/**
 * The file with every layer style `$ref` replaced by its JSON. Problems go to the sink with the layer's
 * key path. Shares every unchanged subtree; returns `file` itself when nothing was a `$ref`.
 */
export function resolveAssets(file: TemplateFile, resolve: AssetResolver, sink: Sink): TemplateFile {
  if (file.views === undefined) return file;
  let changed = false;
  const views: Record<string, View> = {};
  for (const [vk, view] of Object.entries(file.views)) {
    let nextLayers: Record<string, Layer> | undefined;
    for (const [lk, layer] of Object.entries(view.layers ?? {})) {
      const style = layer.style;
      if (style === undefined) continue;
      const path = kp('views', vk, 'layers', lk, 'style');
      let json: unknown = style;
      if (isRef(style)) {
        json = resolve(style.$ref);
        if (json === undefined) {
          sink.error(
            path,
            'asset_unresolved',
            `the style '${style.$ref}' is not in the project bundle`,
            resolve === NO_ASSETS
              ? 'the file must be self-contained: embed the style at ingestion (compile with the bundle) or inline it'
              : `add ${style.$ref} to the bundle, or fix the path`,
            resolve === NO_ASSETS ? { ref: style.$ref } : { variant: 'style_bundle', ref: style.$ref },
          );
          continue;
        }
      }
      const shape = STYLE_SHAPES[layer.renderer] ?? anyObject;
      const errors = RENDERERS.has(layer.renderer) ? shape(json) : anyObject(json);
      for (const message of errors) {
        sink.error(path, 'style_invalid', message, 'fix the style so it fits its renderer, see docs/05', {
          detail: message,
          renderer: layer.renderer,
        });
      }
      if (errors.length > 0 || !isRef(style)) continue;
      nextLayers ??= { ...view.layers };
      nextLayers[lk] = { ...layer, style: json as Record<string, never> };
    }
    if (nextLayers === undefined) views[vk] = view;
    else {
      changed = true;
      views[vk] = { ...view, layers: nextLayers };
    }
  }
  return changed ? { ...file, views } : file;
}
