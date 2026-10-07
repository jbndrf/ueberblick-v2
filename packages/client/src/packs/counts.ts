// Storage counts of the offline packs: bytes, tiles and layers per pack (WP-650's "Kacheln" row). The tile count
// comes from the manifest, never from reading a header. Files (the kept photo thumbnails, `ThumbCache.count`) and
// records are counted by their own stores, not here.
import type { PackCounts, PackIndex } from './contract';

export function storageCounts(index: PackIndex): PackCounts {
  const packs = Object.values(index.packs).map((p) => ({
    key: p.key,
    label: p.label,
    bytes: p.layers.reduce((n, l) => n + l.bytes, 0),
    tiles: p.layers.reduce((n, l) => n + l.tiles, 0),
    layers: p.layers.length,
    built_at: p.built_at,
  }));
  return {
    packs,
    totals: {
      packs: packs.length,
      bytes: packs.reduce((n, p) => n + p.bytes, 0),
      tiles: packs.reduce((n, p) => n + p.tiles, 0),
    },
  };
}
