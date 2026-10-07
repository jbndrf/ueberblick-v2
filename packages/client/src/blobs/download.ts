// Fills the ThumbCache with the thumbnails of the photos in scope (v3 `pack-downloader` "Downloading files"). Bounded:
// a few fetches at once, skips what is on the device, stops at the byte cap or when told to. A photo the server has no
// thumbnail for, or a broken connection, costs that photo only (v3: "Non-fatal: file just won't display offline").
import {
  THUMB_CACHE_MAX_BYTES,
  THUMB_FETCH_CONCURRENCY,
  type ThumbCache,
  type ThumbProgress,
  type ThumbTransport,
} from './contract';

export interface DownloadThumbsInput {
  readonly shas: readonly string[];
  readonly cache: ThumbCache;
  readonly transport: ThumbTransport;
  readonly onProgress?: (p: ThumbProgress) => void;
  readonly signal?: AbortSignal;
  readonly concurrency?: number;
  readonly maxBytes?: number;
}

export interface DownloadThumbsResult {
  readonly stored: number;
  readonly failed: number;
  /** Why it ended early; undefined when every photo was handled. */
  readonly stopped: 'full' | 'aborted' | undefined;
}

export async function downloadThumbs(input: DownloadThumbsInput): Promise<DownloadThumbsResult> {
  const { cache, transport, signal } = input;
  const max = input.maxBytes ?? THUMB_CACHE_MAX_BYTES;
  const shas = [...new Set(input.shas)];
  let used = await cache.bytes();
  let next = 0;
  let done = 0;
  let stored = 0;
  let failed = 0;
  let stopped: DownloadThumbsResult['stopped'];

  async function worker(): Promise<void> {
    while (stopped === undefined) {
      if (signal?.aborted === true) {
        stopped = 'aborted';
        return;
      }
      if (used >= max) {
        stopped = 'full';
        return;
      }
      const sha = shas[next++];
      if (sha === undefined) return;
      try {
        if (!(await cache.has(sha))) {
          const got = await transport.fetch(sha, signal);
          if (got === undefined) failed += 1;
          else {
            await cache.put(sha, got.bytes, got.mime);
            used += got.bytes.length;
            stored += 1;
          }
        }
      } catch {
        failed += 1;
      }
      done += 1;
      input.onProgress?.({ done, total: shas.length });
    }
  }

  const n = Math.max(1, Math.min(input.concurrency ?? THUMB_FETCH_CONCURRENCY, shas.length));
  await Promise.all(Array.from({ length: n }, worker));
  return { stored, failed, stopped };
}
