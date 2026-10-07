/** What kind of tile bytes are: the cache extension, the content type and the PMTiles tile type come from this one place. */
export interface TileFormat {
  readonly ext: string;
  readonly contentType: string;
}

export const TILE_FORMATS: readonly TileFormat[] = [
  { ext: 'png', contentType: 'image/png' },
  { ext: 'jpg', contentType: 'image/jpeg' },
  { ext: 'webp', contentType: 'image/webp' },
  { ext: 'avif', contentType: 'image/avif' },
  { ext: 'gif', contentType: 'image/gif' },
  { ext: 'mvt', contentType: 'application/vnd.mapbox-vector-tile' },
];

export const formatOfExt = (ext: string): TileFormat | undefined => TILE_FORMATS.find((f) => f.ext === ext);

const starts = (b: Uint8Array, at: number, sig: readonly number[]): boolean =>
  sig.every((v, i) => b[at + i] === v);

/** The raster format of the bytes by their magic number, or `undefined` (an HTML error page is not a tile). */
export function sniffRaster(b: Uint8Array): TileFormat | undefined {
  if (starts(b, 0, [0x89, 0x50, 0x4e, 0x47])) return formatOfExt('png');
  if (starts(b, 0, [0xff, 0xd8, 0xff])) return formatOfExt('jpg');
  if (starts(b, 0, [0x52, 0x49, 0x46, 0x46]) && starts(b, 8, [0x57, 0x45, 0x42, 0x50]))
    return formatOfExt('webp');
  if (starts(b, 4, [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66])) return formatOfExt('avif');
  if (starts(b, 0, [0x47, 0x49, 0x46, 0x38])) return formatOfExt('gif');
  return undefined;
}
