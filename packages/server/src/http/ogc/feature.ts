/** A `features` row as a GeoJSON Feature (RFC 7946), cut to the properties the actor may read. */
import {
  compilePerms,
  type Actor,
  type CompiledConfig,
  type Geometry,
  type Json,
  type Perms,
} from '@ueberblick/core';
import type { CrsSeam } from './seams';
import { CRS84 } from './seams';

export interface FeatureRow {
  readonly rid: number;
  readonly id: string;
  readonly type: string;
  readonly properties: string;
  readonly geometry: string | null;
}

export interface GeoJsonFeature {
  readonly type: 'Feature';
  readonly id: string;
  readonly geometry: Geometry | null;
  readonly properties: { readonly [k: string]: Json };
}

const permsCache = new WeakMap<CompiledConfig, Perms>();
/** Compiled permissions of a config, once per config object. */
export function permsOf(config: CompiledConfig): Perms {
  let p = permsCache.get(config);
  if (p === undefined) {
    p = compilePerms(config);
    permsCache.set(config, p);
  }
  return p;
}

/** The key of the geometry a type serves as the Feature geometry (its declared primary geometry). */
export const primaryGeometry = (config: CompiledConfig, type: string): string | undefined =>
  config.foldTypes.get(type as never)?.primaryGeometry;

export interface Serializer {
  (row: FeatureRow): GeoJsonFeature;
}

/** A serializer for one (type, actor, output CRS); the readable set is computed once, not per row. */
export function serializerFor(
  config: CompiledConfig,
  type: string,
  actor: Actor,
  crs: CrsSeam,
  outCrs: string,
): Serializer {
  const perms = permsOf(config);
  const readable = perms.forType(type as never)?.readable(perms.subjects(actor)) ?? new Set<string>();
  const geoKey = primaryGeometry(config, type);
  const geoReadable = geoKey !== undefined && readable.has(geoKey);
  return (row) => {
    const all = JSON.parse(row.properties) as { [k: string]: Json };
    const properties: { [k: string]: Json } = {};
    for (const k of Object.keys(all)) if (k !== geoKey && readable.has(k)) properties[k] = all[k] as Json;
    let geometry: Geometry | null = null;
    if (geoReadable && row.geometry !== null) {
      const g = JSON.parse(row.geometry) as Geometry;
      geometry = outCrs === CRS84 ? g : crs.fromWgs84(g, outCrs);
    }
    return { type: 'Feature', id: row.id, geometry, properties };
  };
}
