/**
 * Budgets (docs/12, WP-405), derived from the run-endpoint row (<= 50 ms p95) and the 1-vCPU server of the baseline:
 * - converting a 50 MB MBTiles into one PMTiles archive finishes in <= 30 s (>= 1.7 MB/s) and adds <= 120 MB of
 *   resident memory (the file is never held whole: tiles stream through a spool file, 256 at a time);
 * - the conversion yields: no stall of the event loop above 50 ms while it runs, so other requests are not blocked.
 * Run: npm run bench -- bench/tile-upload
 */
import { randomBytes } from 'node:crypto';
import { createReadStream, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { createDiskStore } from '../../packages/server/src/tiles/upload/store';
import { createTileUploads } from '../../packages/server/src/tiles/upload/service';
import { image, mbtiles, type MbTile } from '../../packages/server/src/tiles/upload/testkit';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

const MAX_ZOOM = 6;
const TILE_BYTES = 9_500;

describe('tile upload conversion', () => {
  it('50 MB MBTiles: throughput, peak RSS and the longest event-loop stall', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tile-upload-bench-'));
    try {
      const tiles: MbTile[] = [];
      for (let z = 0; z <= MAX_ZOOM; z++)
        for (let x = 0; x < 2 ** z; x++)
          for (let y = 0; y < 2 ** z; y++)
            tiles.push({ z, x, y, data: Buffer.concat([image(`${z}/${x}/${y}`), randomBytes(TILE_BYTES)]) });
      const file = join(dir, 'in.mbtiles');
      mbtiles(file, tiles);
      const size = statSync(file).size;
      tiles.length = 0;

      const uploads = createTileUploads({
        store: createDiskStore((p) => join(dir, 'tiles', p)),
        now: () => new Date().toISOString(),
      });
      const job = uploads.start('bench', { kind: 'mbtiles', name: 'bench', size });
      // Hand the file over by chunks of the registry size, as the endpoint would.
      const step = 8 * 1024 * 1024;
      for (let at = 0; at < size; at += step)
        await uploads.chunk(
          'bench',
          job.id,
          at,
          createReadStream(file, {
            start: at,
            end: Math.min(size, at + step) - 1,
          }) as AsyncIterable<Uint8Array>,
        );

      let peak = process.memoryUsage().rss;
      let stall = 0;
      let last = performance.now();
      const probe = setInterval(() => {
        peak = Math.max(peak, process.memoryUsage().rss);
      }, 20);
      let running = true;
      const loop = (async () => {
        while (running) {
          await new Promise((r) => setImmediate(r));
          const now = performance.now();
          stall = Math.max(stall, now - last);
          last = now;
        }
      })();
      const before = process.memoryUsage().rss;
      const t0 = performance.now();
      uploads.finish('bench', job.id);
      await uploads.idle();
      const ms = performance.now() - t0;
      running = false;
      await loop;
      clearInterval(probe);
      const done = uploads.status('bench', job.id);
      if (done?.state !== 'done') throw new Error(`conversion ended as ${done?.state}`);
      const rssMb = Math.max(0, (peak - before) / 1e6);
      console.info(
        `tile upload: ${(size / 1e6).toFixed(1)} MB MBTiles, ${done.result?.tiles} tiles in ${ms.toFixed(0)} ms = ` +
          `${((size / 1e6 / ms) * 1000).toFixed(1)} MB/s, RSS +${rssMb.toFixed(0)} MB, longest stall ${stall.toFixed(0)} ms`,
      );
      assertBudget(
        report(
          defineBudget({
            id: 'tile-upload-50mb-ms',
            limit: 30_000,
            unit: 'ms',
            derivedFrom: 'a 50 MB MBTiles converts in <= 30 s on the 1-vCPU baseline (docs/12, WP-405)',
            device: 'server',
          }),
          Math.round(ms),
        ),
      );
      assertBudget(
        report(
          defineBudget({
            id: 'tile-upload-rss-mb',
            limit: 120,
            unit: 'MB',
            derivedFrom:
              'server-idle-rss: the conversion streams, it adds <= 120 MB resident (docs/12, WP-405)',
            device: 'server',
          }),
          Math.round(rssMb),
        ),
      );
      assertBudget(
        report(
          defineBudget({
            id: 'tile-upload-stall-ms',
            limit: 50,
            unit: 'ms',
            derivedFrom:
              'run-endpoint-p95: the conversion yields so a run is never held up (docs/12, WP-405)',
            device: 'server',
          }),
          Math.round(stall),
        ),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
