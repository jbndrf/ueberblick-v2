/**
 * Budget (WP-527, docs/12): photo of 12 MP <= 1.5 s, main-thread long task <= 50 ms.
 * Decode/resize/encode run in a worker on an OffscreenCanvas and cannot be timed without a browser; this
 * bench measures what the code adds around the raster step on a 12 MP-sized (6 MB) JPEG: the metadata
 * policy (worker) and the sha256 of the 2 MB result (WebCrypto, asynchronous).
 * Run: npm test -- -c bench/vitest.config.ts bench/photo-pipeline
 */
import { describe, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { processImage, DEFAULT_PHOTO_OPTIONS } from '../../packages/tools/photo/src/pipeline';
import { jpeg } from '../../packages/tools/photo/src/testing';

async function median(runs: number, fn: () => Promise<void>): Promise<number> {
  await fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(runs / 2)] ?? 0;
}

describe('photo pipeline', () => {
  it('metadata policy on a 12 MP-sized JPEG stays far below 50 ms', async () => {
    const original = jpeg({ exif: { gps: true, orientation: 6 }, xmp: true, scan: 6_000_000 });
    const encoded = jpeg({ exif: { gps: true, orientation: 1 }, xmp: true, scan: 2_000_000 });
    const ms = await median(9, async () => {
      await processImage(original, { ...DEFAULT_PHOTO_OPTIONS, allowLocation: true }, async () => ({
        bytes: encoded,
        width: 2048,
        height: 1536,
      }));
    });
    console.log(`bench photo-metadata-6mb: median ${ms.toFixed(1)} ms`);
    assertBudget(
      report(
        defineBudget({
          id: 'photo-metadata-6mb',
          limit: 50,
          unit: 'ms',
          derivedFrom: 'interaction-to-next-paint: photo metadata policy runs in a worker; 50 ms local limit',
          device: 'x4',
          thread: 'worker',
        }),
        Math.round(ms * 10) / 10,
      ),
    );
  });

  it('sha256 of the 2 MB result', async () => {
    const buf = new Uint8Array(2_000_000).fill(7).buffer;
    const ms = await median(9, async () => {
      await crypto.subtle.digest('SHA-256', buf);
    });
    console.log(`bench photo-sha256-2mb: median ${ms.toFixed(1)} ms`);
    assertBudget(
      report(
        defineBudget({
          id: 'photo-sha256-2mb',
          limit: 50,
          unit: 'ms',
          derivedFrom:
            'interaction-to-next-paint: sha256 of a photo (WebCrypto, asynchronous); 50 ms local limit',
          device: 'x4',
          thread: 'worker',
        }),
        Math.round(ms * 10) / 10,
      ),
    );
  });
});
