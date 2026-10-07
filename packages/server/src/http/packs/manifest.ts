/**
 * The device manifest of `GET /api/p/<project>/packs` (A-032 item 3): the `ready` packs of the deployed config the
 * caller may see, with the layers they see. The shape is core's `PackManifest` (`decodePackManifest` is the device's check). The audience is `packsForRoles` (core), the same function the download uses.
 */
import {
  acceptLocales,
  localize,
  packsForRoles,
  packTileType,
  type LocalizedString,
  type PackLayerEntry,
  type PackManifest,
  type PackManifestEntry,
} from '@ueberblick/core';
import type { Db } from '../../db/driver';
import { packTargets, rowsOf, type BuildRow } from '../../packs/store';
import type { DeployedConfig } from '../../sync';

export const packFileUrl = (project: string, hash: string, layer: string): string =>
  `/api/p/${encodeURIComponent(project)}/packs/${hash}/${encodeURIComponent(layer)}.pmtiles`;

/** A built row: every column the manifest reads is set once the state is `ready`. */
function builtRow(rows: readonly BuildRow[], layer: string): BuildRow | undefined {
  const r = rows.find((x) => x.layer === layer);
  return r?.state === 'ready' && r.sha256 !== null && r.max_zoom !== null && r.tiles !== null ? r : undefined;
}

/** The packs of `deployed` the roles see and that are fully built. O(packs x layers) of the project, two reads per pack. */
export function buildManifest(
  db: Db,
  projectKey: string,
  deployed: DeployedConfig | undefined,
  roles: readonly string[],
  acceptLanguage: string | null,
): PackManifest {
  const file = deployed?.config.file;
  if (file?.map === undefined) return { packs: [] };
  const locales = acceptLocales(acceptLanguage);
  const targets = new Map(packTargets(file).map((t) => [t.key, t]));
  const packs: PackManifestEntry[] = [];
  for (const audience of packsForRoles(file.map, roles)) {
    const target = targets.get(audience.key);
    if (target === undefined) continue;
    const rows = rowsOf(db, [target.hash]);
    // A pack is listed once every layer of it is built, whatever the caller sees of it.
    if (target.layers.some((l) => builtRow(rows, l.layer) === undefined)) continue;
    const layers = audience.layers.flatMap((key): PackLayerEntry[] => {
      const row = builtRow(rows, key);
      const def = target.layers.find((l) => l.layer === key)?.def;
      if (row === undefined || def === undefined) return [];
      return [
        {
          layer: key,
          tile_type: packTileType(def),
          url: packFileUrl(projectKey, target.hash, key),
          bytes: row.bytes,
          sha256: row.sha256 ?? '',
          max_zoom: row.max_zoom ?? 0,
          tiles: row.tiles ?? 0,
        },
      ];
    });
    if (layers.length === 0) continue;
    const stamps = audience.layers.flatMap((k) => builtRow(rows, k)?.updated_at ?? []).sort();
    packs.push({
      key: audience.key,
      label: localize(target.def.label as LocalizedString, locales),
      hash: target.hash,
      bounds: target.def.bounds,
      min_zoom: target.def.min_zoom,
      max_zoom: target.def.max_zoom,
      layers,
      bytes: layers.reduce((n, l) => n + l.bytes, 0),
      built_at: stamps[stamps.length - 1] ?? '',
    });
  }
  return { packs };
}
