import { defineRegistry, type KeyOf } from './define';

/**
 * Limits of an uploaded tile archive (A-044, WP-405, R6). A change to a number is an edit here, never a literal in
 * the upload code. One instance holds all of a project's archives, so the numbers are conservative for a 1-vCPU host.
 */
export const TILE_UPLOAD_MAX = defineRegistry([
  {
    key: 'bytes',
    description: 'The largest upload in bytes (ZIP, MBTiles or PMTiles).',
    value: 2_000_000_000,
  },
  { key: 'chunk_bytes', description: 'The largest single chunk of an upload in bytes.', value: 16_777_216 },
  { key: 'tiles', description: 'The most tiles one archive may hold.', value: 1_000_000 },
  { key: 'tile_bytes', description: 'The largest single tile in bytes.', value: 4_194_304 },
  {
    key: 'inflated_bytes',
    description: 'The most bytes all tiles of a ZIP may inflate to (the zip-bomb limit).',
    value: 4_000_000_000,
  },
  { key: 'open_uploads', description: 'Uploads of one project that may be open at once.', value: 3 },
  {
    key: 'stale_hours',
    description: 'Hours after which an upload that is still receiving is abandoned and swept at startup.',
    value: 24,
  },
  { key: 'batch', description: 'Tiles converted between two yields to other requests.', value: 256 },
] as const);
export type TileUploadLimit = KeyOf<typeof TILE_UPLOAD_MAX>;

/** The value of one upload limit. */
export function tileUploadMax(key: TileUploadLimit): number {
  return TILE_UPLOAD_MAX.get(key).value;
}

/** What an admin may upload (v3: ZIP, MBTiles, PMTiles). */
export const TILE_UPLOAD_KINDS = defineRegistry([
  { key: 'zip', description: 'A ZIP of tiles laid out as z/x/y.<ext>.' },
  { key: 'mbtiles', description: 'An MBTiles file (SQLite, rows are TMS).' },
  { key: 'pmtiles', description: 'A PMTiles v3 archive, validated and kept as it is.' },
] as const);
export type TileUploadKind = KeyOf<typeof TILE_UPLOAD_KINDS>;

/** The tile format of an archive; the layer's `tile_type` follows from it (`pbf` is vector, the rest raster). */
export const TILE_UPLOAD_FORMATS = defineRegistry([
  { key: 'png', description: 'PNG images.' },
  { key: 'jpg', description: 'JPEG images.' },
  { key: 'webp', description: 'WebP images.' },
  { key: 'pbf', description: 'Vector tiles (only from MBTiles or PMTiles, never chosen on upload).' },
] as const);
export type TileUploadFormat = KeyOf<typeof TILE_UPLOAD_FORMATS>;

/** The state of one conversion job (polled by the admin tab). */
export const TILE_UPLOAD_STATES = defineRegistry([
  { key: 'receiving', description: 'Chunks are still arriving.' },
  { key: 'queued', description: 'Finished uploading; waiting for the converter.' },
  { key: 'processing', description: 'The converter is writing the archive; progress is reported.' },
  { key: 'done', description: 'The archive is ready and served.' },
  { key: 'failed', description: 'The upload was refused or the conversion failed; the reason is stored.' },
] as const);
export type TileUploadState = KeyOf<typeof TILE_UPLOAD_STATES>;

/** Typed reasons an upload is refused. */
export const TILE_UPLOAD_REFUSALS = defineRegistry([
  { key: 'too_large', description: 'The upload is over `TILE_UPLOAD_MAX.bytes`.' },
  { key: 'too_many_tiles', description: 'The archive holds more tiles than `TILE_UPLOAD_MAX.tiles`.' },
  { key: 'tile_too_large', description: 'A tile is larger than `TILE_UPLOAD_MAX.tile_bytes`.' },
  { key: 'zip_bomb', description: 'The ZIP expands past its limits.' },
  { key: 'not_tiles', description: 'The file holds no tiles in the expected layout.' },
  { key: 'corrupt', description: 'The file is damaged (a bad ZIP, MBTiles or PMTiles).' },
  { key: 'wrong_format', description: 'The tiles are not of the format chosen on upload.' },
  { key: 'bad_chunk', description: 'A chunk does not follow the bytes received so far.' },
  { key: 'incomplete', description: 'The upload ended before all declared bytes arrived.' },
  { key: 'too_many_uploads', description: 'Too many uploads are open in the project.' },
] as const);
export type TileUploadRefusal = KeyOf<typeof TILE_UPLOAD_REFUSALS>;
