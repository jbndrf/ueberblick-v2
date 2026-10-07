/**
 * Offline packs (A-032): the checker refuses a pack the build job could not make. Zoom range, bounds,
 * layers (known, packable), roles and the size estimate (`estimatePack`, the same function the admin dialog and
 * the build job use) are all checked here; messages are in English and German.
 */
import { estimatePack, type Bounds } from '../../geo/tiles';
import { MAP_SOURCE_TYPES, type MapSourceType } from '../../registry';
import { packLimit, packTileType, sourceMaxZoom } from '../../registry/admin';
import type { TemplateFile } from '../file';
import type { MapPack } from '../map';
import { kp } from './kp';
import type { Sink } from './problems';
import { refuseUnknownRole } from './unknown-role';

const MIB = 1024 * 1024;

function validBounds([w, s, e, n]: Bounds): boolean {
  const inRange = (v: number, max: number): boolean => Number.isFinite(v) && v >= -max && v <= max;
  return inRange(w, 180) && inRange(e, 180) && inRange(s, 90) && inRange(n, 90) && w < e && s < n;
}

function validZoom(pack: MapPack): boolean {
  const lo = packLimit('min_zoom');
  const hi = packLimit('max_zoom');
  return pack.min_zoom >= lo && pack.max_zoom <= hi && pack.min_zoom <= pack.max_zoom;
}

export function checkPacks(file: TemplateFile, sink: Sink): void {
  const packs = file.map?.packs;
  if (packs === undefined) return;
  const layers = file.map?.layers ?? {};
  const roles = Object.keys(file.roles ?? {});
  for (const [key, pack] of Object.entries(packs)) {
    const at = (...rest: (string | number)[]) => kp('map', 'packs', key, ...rest);
    let packable = true;
    pack.layers.forEach((layerKey, i) => {
      const layer = layers[layerKey];
      if (layer === undefined) {
        packable = false;
        sink.error(
          at('layers', i),
          'pack_unknown_layer',
          {
            en: `pack '${key}': '${layerKey}' is not a map layer`,
            de: `Paket '${key}': '${layerKey}' ist keine Kartenebene`,
          },
          `use one of: ${Object.keys(layers).join(', ') || 'declare a map layer first'}`,
          { pack: key, layer: layerKey, existing: Object.keys(layers).join(', ') },
        );
      } else if (!MAP_SOURCE_TYPES.get(layer.source.type as MapSourceType).packable) {
        packable = false;
        sink.error(
          at('layers', i),
          'pack_layer_not_packable',
          {
            en: `pack '${key}': layer '${layerKey}' (${layer.source.type}) cannot be packed`,
            de: `Paket '${key}': Ebene '${layerKey}' (${layer.source.type}) kann nicht gepackt werden`,
          },
          `only layers with a source of type ${MAP_SOURCE_TYPES.entries
            .filter((e) => e.packable)
            .map((e) => e.key)
            .join(', ')} can be packed, see docs/05`,
          { pack: key, layer: layerKey, kind: layer.source.type },
        );
      }
    });
    pack.roles?.forEach((role, i) =>
      refuseUnknownRole(
        sink,
        roles,
        role,
        at('roles', i),
        'pack_unknown_role',
        { en: `pack '${key}'`, de: `Paket '${key}'` },
        { pack: key },
      ),
    );
    const zoomOk = validZoom(pack);
    if (!zoomOk)
      sink.error(
        at('min_zoom'),
        'pack_zoom_range',
        {
          en: `pack '${key}': zoom ${pack.min_zoom} to ${pack.max_zoom} is not a range inside ${packLimit('min_zoom')} to ${packLimit('max_zoom')}`,
          de: `Paket '${key}': Zoom ${pack.min_zoom} bis ${pack.max_zoom} ist kein Bereich innerhalb von ${packLimit('min_zoom')} bis ${packLimit('max_zoom')}`,
        },
        `set min_zoom at most max_zoom, both from ${packLimit('min_zoom')} to ${packLimit('max_zoom')}`,
        {
          pack: key,
          min: pack.min_zoom,
          max: pack.max_zoom,
          limit_min: packLimit('min_zoom'),
          limit_max: packLimit('max_zoom'),
        },
      );
    const boundsOk = validBounds(pack.bounds);
    if (!boundsOk)
      sink.error(
        at('bounds'),
        'pack_bounds',
        {
          en: `pack '${key}': bounds must be [west, south, east, north] in WGS84 with west < east and south < north`,
          de: `Paket '${key}': bounds muss [West, Süd, Ost, Nord] in WGS84 sein, mit West < Ost und Süd < Nord`,
        },
        'e.g. [7.08, 50.70, 7.14, 50.75]',
        { pack: key },
      );
    if (!(zoomOk && boundsOk && packable)) continue;
    const est = estimatePack(
      pack.bounds,
      pack.min_zoom,
      pack.max_zoom,
      pack.layers.flatMap((k) => {
        const layer = layers[k];
        return layer === undefined
          ? []
          : [{ key: k, tileType: packTileType(layer), sourceMaxZoom: sourceMaxZoom(layer) }];
      }),
    );
    if (est.tiles > packLimit('max_tiles') || est.bytes > packLimit('max_bytes'))
      sink.error(
        at('max_zoom'),
        'pack_too_large',
        {
          en: `pack '${key}': about ${est.tiles} tiles and ${Math.round(est.bytes / MIB)} MB, above the limit of ${packLimit('max_tiles')} tiles and ${Math.round(packLimit('max_bytes') / MIB)} MB`,
          de: `Paket '${key}': etwa ${est.tiles} Kacheln und ${Math.round(est.bytes / MIB)} MB, über dem Limit von ${packLimit('max_tiles')} Kacheln und ${Math.round(packLimit('max_bytes') / MIB)} MB`,
        },
        'make the area smaller, lower max_zoom or drop a layer',
        {
          pack: key,
          tiles: est.tiles,
          megabytes: Math.round(est.bytes / MIB),
          limit_tiles: packLimit('max_tiles'),
          limit_megabytes: Math.round(packLimit('max_bytes') / MIB),
        },
      );
  }
}
