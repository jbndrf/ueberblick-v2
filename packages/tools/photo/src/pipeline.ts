// The image pipeline: raster (decode, resize, encode) through a port, then metadata policy.
import { ToolHostError } from '@ueberblick/ui/tool-api';
import { exifForReuse, stripMetadata, withExif } from './exif';

export interface PhotoOptions {
  /** Longest edge of the result in pixels. */
  readonly maxEdge: number;
  /** JPEG quality, 0 to 1. */
  readonly quality: number;
  /** Keep the EXIF (location) of the original. Off unless the field allows it. */
  readonly allowLocation: boolean;
}

export const DEFAULT_PHOTO_OPTIONS: PhotoOptions = { maxEdge: 2048, quality: 0.85, allowLocation: false };

export interface RasterResult {
  /** JPEG bytes. */
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** Decodes the original (applying its orientation), scales it to fit `maxEdge` and encodes a JPEG.
 * The browser implementation is an OffscreenCanvas in a worker (`canvas-raster.ts`). */
export type Rasterizer = (
  bytes: Uint8Array,
  target: { readonly maxEdge: number; readonly quality: number },
) => Promise<RasterResult>;

/** The size that fits `maxEdge`, never enlarged, aspect ratio kept, at least 1 pixel. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Reads the tool options (project file `tools.photo`). Absent options take the default; a present
 * but invalid option is a `ToolHostError` (`invalid_option`), never a silent default (R11). */
export function readPhotoOptions(raw: Readonly<Record<string, unknown>>): PhotoOptions {
  const d = DEFAULT_PHOTO_OPTIONS;
  const bad = (name: string): never => {
    throw new ToolHostError('invalid_option', 'photo', `Invalid photo option "${name}"`);
  };
  const { maxEdge, quality, allowLocation } = raw;
  if (
    maxEdge !== undefined &&
    !(typeof maxEdge === 'number' && Number.isInteger(maxEdge) && maxEdge >= 16 && maxEdge <= 16384)
  )
    bad('maxEdge');
  if (quality !== undefined && !(typeof quality === 'number' && quality > 0 && quality <= 1)) bad('quality');
  if (allowLocation !== undefined && typeof allowLocation !== 'boolean') bad('allowLocation');
  return {
    maxEdge: (maxEdge as number | undefined) ?? d.maxEdge,
    quality: (quality as number | undefined) ?? d.quality,
    allowLocation: (allowLocation as boolean | undefined) ?? d.allowLocation,
  };
}

export async function processImage(
  original: Uint8Array,
  opts: PhotoOptions,
  raster: Rasterizer,
): Promise<RasterResult> {
  const out = await raster(original, opts);
  const clean = stripMetadata(out.bytes);
  const exif = opts.allowLocation ? exifForReuse(original) : null;
  return { ...out, bytes: exif ? withExif(clean, exif) : clean };
}
