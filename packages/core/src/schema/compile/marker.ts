/**
 * The look of a type on the map (WP-674, B-018): `resolveMarkerIcons` embeds every `{ $ref }` icon through the
 * assets port (B-013), `checkMarkers` checks `classify` and every inline SVG. The SVG check itself is
 * `checkMarkerSvg` (`schema/marker.ts`), the one copy the builder uses too (R1).
 */
import type { FeatureType } from '../feature-type';
import type { TemplateFile } from '../file';
import { checkMarkerSvg } from '../../marker';
import type { MarkerAppearance, MarkerIconConfig } from '../marker';
import type { AssetResolver } from './assets';
import { NO_ASSETS } from './assets';
import { kp } from './kp';
import type { Sink } from './problems';

type IconSlot = (
  appearance: MarkerAppearance | undefined,
  path: readonly string[],
) => MarkerAppearance | undefined;

const withIcon = (a: MarkerAppearance, icon: MarkerIconConfig): MarkerAppearance => ({ ...a, icon });

/** The file with every `{ $ref, size? }` icon replaced by `{ svg, size? }`. Unresolved refs go to the sink. */
export function resolveMarkerIcons(file: TemplateFile, resolve: AssetResolver, sink: Sink): TemplateFile {
  if (file.types === undefined) return file;
  let changed = false;
  const slot: IconSlot = (a, path) => {
    const icon = a?.icon;
    if (a === undefined || icon === undefined || !('$ref' in icon)) return a;
    const at = kp(...path, 'icon');
    const text = resolve(icon.$ref);
    if (typeof text !== 'string') {
      sink.error(
        at,
        'asset_unresolved',
        `the icon '${icon.$ref}' is not in the project bundle`,
        resolve === NO_ASSETS
          ? 'the file must be self-contained: embed the icon at ingestion (compile with the bundle) or inline it'
          : `add ${icon.$ref} to the bundle, or fix the path`,
        resolve === NO_ASSETS
          ? { variant: 'icon', ref: icon.$ref }
          : { variant: 'icon_bundle', ref: icon.$ref },
      );
      return a;
    }
    changed = true;
    return withIcon(a, { svg: text, ...(icon.size !== undefined && { size: icon.size }) });
  };
  const types: Record<string, FeatureType> = {};
  for (const [tk, type] of Object.entries(file.types)) {
    const marker = slot(type.marker, ['types', tk, 'marker']);
    let values = type.classify?.values;
    if (values !== undefined) {
      const next: NonNullable<typeof values> = {};
      for (const [vk, a] of Object.entries(values)) {
        next[vk] = slot(a, ['types', tk, 'classify', 'values', vk]) ?? a;
      }
      values = next;
    }
    types[tk] = {
      ...type,
      ...(marker !== undefined && { marker }),
      ...(type.classify !== undefined && values !== undefined && { classify: { ...type.classify, values } }),
    };
  }
  return changed ? { ...file, types } : file;
}

/** `classify.property` is a select of the type, every `values` key an option, every inline SVG passes the check. */
export function checkMarkers(file: TemplateFile, sink: Sink): void {
  for (const [tk, type] of Object.entries(file.types ?? {})) {
    const svg = (a: MarkerAppearance | undefined, path: readonly string[]): void => {
      const icon = a?.icon;
      if (icon === undefined || !('svg' in icon)) return;
      for (const message of checkMarkerSvg(icon.svg)) {
        sink.error(
          kp(...path, 'icon', 'svg'),
          'marker_icon_invalid',
          message,
          'use a plain SVG: shapes, paths and gradients only',
          { detail: message },
        );
      }
    };
    svg(type.marker, ['types', tk, 'marker']);
    const classify = type.classify;
    if (classify === undefined) continue;
    for (const [vk, a] of Object.entries(classify.values)) svg(a, ['types', tk, 'classify', 'values', vk]);
    const prop = type.properties[classify.property];
    if (prop === undefined || prop.type !== 'select') {
      sink.error(
        kp('types', tk, 'classify', 'property'),
        'classify_property_invalid',
        {
          en: `classify property '${classify.property}' of ${tk} is not a select property`,
          de: `Die Klassifizierungs-Eigenschaft '${classify.property}' von ${tk} ist keine Auswahl-Eigenschaft`,
        },
        `name a property of type select of ${tk}, e.g. its stage property`,
        { type: tk, property: classify.property },
      );
      continue;
    }
    const options = Object.keys(prop.options ?? {});
    for (const vk of Object.keys(classify.values)) {
      if (options.includes(vk)) continue;
      sink.error(
        kp('types', tk, 'classify', 'values', vk),
        'classify_value_unknown',
        {
          en: `'${vk}' is not an option of ${tk}.${classify.property}`,
          de: `'${vk}' ist keine Option von ${tk}.${classify.property}`,
        },
        `use one of: ${options.join(', ')}`,
        { value: vk, type: tk, property: classify.property, existing: options.join(', ') },
      );
    }
  }
}
