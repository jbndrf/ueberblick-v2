/**
 * The content hash of an offline pack (A-032 item 2): `sha256(canonical(pack definition) + per layer its canonical
 * source)`. Only what changes the tiles goes in (bounds, zooms, layers with their source and `maxzoom`); the label and
 * `roles` are audience and wording, so changing them reuses the built files.
 */
import { createHash } from 'node:crypto';
import { canonicalJson, type MapLayer, type TemplateFile } from '@ueberblick/core';

export type PackDef = NonNullable<NonNullable<TemplateFile['map']>['packs']>[string];

/** The hash format: bump it when the canonical form changes, so every pack rebuilds once. */
const HASH_FORMAT = 'pack/1';

export function packHash(pack: PackDef, layers: Readonly<Record<string, MapLayer | undefined>>): string {
  const canon = canonicalJson({
    format: HASH_FORMAT,
    bounds: pack.bounds,
    min_zoom: pack.min_zoom,
    max_zoom: pack.max_zoom,
    layers: [...pack.layers].sort().map((key) => ({
      key,
      source: layers[key]?.source ?? null,
      maxzoom: layers[key]?.maxzoom,
    })),
  });
  return createHash('sha256').update(canon).digest('hex');
}
