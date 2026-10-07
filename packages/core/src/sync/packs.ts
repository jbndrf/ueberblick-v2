// The offline pack manifest (contract A-032, `GET /api/p/<project>/packs`): the types the device and the server's
// builder share, and the decoder the device runs on the server's answer. Pure (R2): no I/O, never throws; a bad
// answer is a refusal with the path of the first wrong field. Unknown fields are ignored, so the manifest can grow.
import { PACK_TILE_TYPES, type PackTileType } from '../registry/packs';

/** One layer file of a pack, as the manifest lists it. */
export interface PackLayerEntry {
  readonly layer: string;
  readonly tile_type: PackTileType;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
  /** The layer's own built maximum; the protocol overzooms above it. */
  readonly max_zoom: number;
  /** Tile count of this file (the storage counts use it; the header is never read for it). */
  readonly tiles: number;
}

/** One pack of the manifest. */
export interface PackManifestEntry {
  readonly key: string;
  readonly label: string;
  readonly hash: string;
  readonly bounds: readonly [number, number, number, number];
  readonly min_zoom: number;
  readonly max_zoom: number;
  readonly layers: readonly PackLayerEntry[];
  readonly bytes: number;
  readonly built_at: string;
}

export interface PackManifest {
  readonly packs: readonly PackManifestEntry[];
}

export type PackManifestDecoding =
  { readonly ok: true; readonly manifest: PackManifest } | { readonly ok: false; readonly reason: string };

class Refusal extends Error {}

type Rec = Readonly<Record<string, unknown>>;
const refuse = (path: string, want: string): never => {
  throw new Refusal(`${path}: ${want}`);
};
const rec = (v: unknown, path: string): Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : refuse(path, 'must be an object');
const text = (o: Rec, k: string, path: string): string =>
  typeof o[k] === 'string' && o[k] !== ''
    ? (o[k] as string)
    : refuse(`${path}.${k}`, 'must be a non-empty string');
const count = (o: Rec, k: string, path: string): number =>
  Number.isInteger(o[k]) && (o[k] as number) >= 0
    ? (o[k] as number)
    : refuse(`${path}.${k}`, 'must be a non-negative integer');
const SHA256 = /^[0-9a-f]{64}$/;

function layerOf(raw: unknown, path: string): PackLayerEntry {
  const o = rec(raw, path);
  const tile = o['tile_type'];
  if (typeof tile !== 'string' || !PACK_TILE_TYPES.has(tile))
    refuse(`${path}.tile_type`, `must be one of ${PACK_TILE_TYPES.keys.join(', ')}`);
  const sha256 = text(o, 'sha256', path);
  if (!SHA256.test(sha256)) refuse(`${path}.sha256`, 'must be 64 lowercase hex digits');
  return {
    layer: text(o, 'layer', path),
    tile_type: tile as PackTileType,
    url: text(o, 'url', path),
    bytes: count(o, 'bytes', path),
    sha256,
    max_zoom: count(o, 'max_zoom', path),
    tiles: count(o, 'tiles', path),
  };
}

function packOf(raw: unknown, path: string): PackManifestEntry {
  const o = rec(raw, path);
  const b = o['bounds'];
  if (!Array.isArray(b) || b.length !== 4 || !b.every((n) => typeof n === 'number' && Number.isFinite(n)))
    refuse(`${path}.bounds`, 'must be four finite numbers [west, south, east, north]');
  const layers = o['layers'];
  if (!Array.isArray(layers)) refuse(`${path}.layers`, 'must be a list');
  return {
    key: text(o, 'key', path),
    label: text(o, 'label', path),
    hash: text(o, 'hash', path),
    bounds: b as [number, number, number, number],
    min_zoom: count(o, 'min_zoom', path),
    max_zoom: count(o, 'max_zoom', path),
    layers: (layers as unknown[]).map((l, i) => layerOf(l, `${path}.layers[${i}]`)),
    bytes: count(o, 'bytes', path),
    built_at: text(o, 'built_at', path),
  };
}

/** Validates the server's answer; the manifest holds only the known fields. */
export function decodePackManifest(json: unknown): PackManifestDecoding {
  try {
    const o = rec(json, 'manifest');
    if (!Array.isArray(o['packs'])) refuse('packs', 'must be a list');
    return {
      ok: true,
      manifest: { packs: (o['packs'] as unknown[]).map((p, i) => packOf(p, `packs[${i}]`)) },
    };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, reason: e.message };
    throw e;
  }
}
