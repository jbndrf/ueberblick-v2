import type { TemplateFile } from '@ueberblick/core';

/**
 * The keys in a config that use the archive at `url`: `map.layers.<key>` for each layer of source type `pmtiles` with
 * that URL, and `map.packs.<key>` for each pack that holds such a layer.
 */
export function archiveReferences(file: TemplateFile | undefined, url: string): string[] {
  const map = file?.map;
  if (map === undefined) return [];
  const layers = Object.entries(map.layers ?? {})
    .filter(([, l]) => l.source.type === 'pmtiles' && l.source.url === url)
    .map(([k]) => k);
  const packs = Object.entries(map.packs ?? {})
    .filter(([, p]) => p.layers.some((l) => layers.includes(l)))
    .map(([k]) => `map.packs.${k}`);
  return [...layers.map((k) => `map.layers.${k}`), ...packs];
}
