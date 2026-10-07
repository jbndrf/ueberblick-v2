/**
 * Server-made thumbnails of image blobs (WP-618). One derived file per (sha256, size), written once next to the
 * blob and served from there afterwards. Sizes live in the core `THUMB_SIZES` registry; EXIF orientation is
 * applied and all metadata (GPS included) is dropped.
 */
import { createReadStream, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type SharpFn from 'sharp';
import { THUMB_SIZES, type ThumbSizeKey } from '@ueberblick/core';
import { assertSha256, type ByteSource } from './store';

export const THUMB_MIME = 'image/webp';
const QUALITY = 80;
/** Refuse decompression bombs (about 100 MP). */
const MAX_INPUT_PIXELS = 100_000_000;

/** Why a thumbnail could not be made although the blob is an image: the bytes do not decode, or the file cannot be written. */
export class ThumbnailFailed extends Error {
  constructor(
    readonly code: 'decode_failed' | 'write_failed',
    cause: unknown,
  ) {
    super(`thumbnail ${code}`, { cause });
    this.name = 'ThumbnailFailed';
  }
}

export interface Thumbnails {
  /**
   * The thumbnail as a stream; undefined when there is nothing to make it from (not an image type, no source).
   * Generated on first use. Rejects with `ThumbnailFailed` when an image cannot be turned into a thumbnail.
   */
  get(
    sha256: string,
    size: ThumbSizeKey,
    mime: string,
    source: () => ByteSource | undefined,
  ): Promise<{ readonly bytes: number; readonly stream: ByteSource } | undefined>;
}

async function collect(source: ByteSource): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of source) parts.push(Buffer.from(chunk));
  return Buffer.concat(parts);
}

let sharpModule: Promise<typeof SharpFn> | undefined;
/** sharp (libvips, about 7 MB resident) loads at the first thumbnail, not at server start (WP-1008). */
function loadSharp(): Promise<typeof SharpFn> {
  sharpModule ??= import('sharp').then((m) => m.default);
  return sharpModule;
}

/** `dir` holds the derived files (`<sha256>.<size>.webp`). Concurrent first requests share one generation. */
export function createThumbnails(dir: string): Thumbnails {
  const pending = new Map<string, Promise<boolean>>();
  async function make(path: string, size: ThumbSizeKey, source: ByteSource | undefined): Promise<boolean> {
    if (source === undefined) return false;
    const spec = THUMB_SIZES.get(size);
    let out: Buffer;
    const sharp = await loadSharp();
    try {
      out = await sharp(await collect(source), { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate() // applies EXIF orientation; the output carries no metadata unless asked
        .resize(
          'height' in spec
            ? {
                width: spec.width,
                height: spec.height,
                fit: spec.crop ? 'cover' : 'contain',
                withoutEnlargement: true,
              }
            : { width: spec.width, withoutEnlargement: true },
        )
        .webp({ quality: QUALITY })
        .toBuffer();
    } catch (e) {
      throw new ThumbnailFailed('decode_failed', e); // an image type whose bytes sharp cannot decode
    }
    try {
      mkdirSync(dir, { recursive: true });
      const tmp = `${path}.${randomUUID()}.tmp`;
      writeFileSync(tmp, out);
      renameSync(tmp, path);
    } catch (e) {
      throw new ThumbnailFailed('write_failed', e);
    }
    return true;
  }
  return {
    async get(sha256, size, mime, source) {
      if (!mime.startsWith('image/') || mime.startsWith('image/svg')) return undefined;
      assertSha256(sha256);
      const path = join(dir, `${sha256}.${size}.webp`);
      if (!existsSync(path)) {
        let job = pending.get(path);
        if (job === undefined) {
          job = make(path, size, source()).finally(() => pending.delete(path));
          pending.set(path, job);
        }
        if (!(await job)) return undefined;
      }
      return { bytes: statSync(path).size, stream: createReadStream(path) };
    },
  };
}
