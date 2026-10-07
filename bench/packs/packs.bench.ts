/**
 * Budget (docs/12, WP-350): the pack build job copies tiles out of a pmtiles source at >= 2,000 tiles/s from a local
 * fixture (a 21,845-tile pyramid read by range from memory, written to disk as a PMTiles v3 file). In production the
 * network is the limit; this proves the job itself (directory lookup, range merging, spool, directory writer) is not.
 * Run: npm test -- -c bench/vitest.config.ts bench/packs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { openProjectDb } from '../../packages/server/src/db/open';
import { buildLayer } from '../../packages/server/src/packs/build';
import { fixtureArchive, must, packFile, serve } from '../../packages/server/src/packs/testkit';
import { packTargets, enqueuePacks, claimNext, rowsOf } from '../../packages/server/src/packs/store';

const MAX_ZOOM = 7;
const TILES = (4 ** (MAX_ZOOM + 1) - 1) / 3;

describe('pack build throughput', () => {
  it('builds a layer from a local pmtiles fixture at >= 2,000 tiles/s', async () => {
    const archive = await fixtureArchive(MAX_ZOOM);
    const file = packFile({ world: { bounds: [-179.9, -85, 179.9, 85], min_zoom: 0, max_zoom: MAX_ZOOM } });
    const target = must(packTargets(file)[0]);
    const layer = must(target.layers[0]);
    const dir = mkdtempSync(join(tmpdir(), 'pack-bench-'));
    try {
      const db = openProjectDb(':memory:', 'bench');
      const now = () => '2026-10-02T10:00:00.000Z';
      enqueuePacks(db, file, now());
      const row = must(claimNext(db, now()));
      const t = performance.now();
      await buildLayer({ db, now, fetchRange: serve(archive).fetchRange, dir }, row, target.def, layer.def);
      const ms = performance.now() - t;
      const built = rowsOf(db, [row.pack_hash])[0];
      if (built?.state !== 'ready' || built.tiles !== TILES)
        throw new Error(`bench build is not complete: ${JSON.stringify(built)}`);
      console.info(
        `pack build: ${TILES} tiles in ${ms.toFixed(0)} ms = ${Math.round((TILES / ms) * 1000)} tiles/s`,
      );
      assertBudget(
        report(
          defineBudget({
            id: 'pack-build-20k',
            limit: Math.round((TILES / 2000) * 1000),
            unit: 'ms',
            derivedFrom:
              'background job, no table row: >= 2,000 tiles/s from a local fixture (docs/12, WP-350)',
            device: 'server',
          }),
          Math.round(ms),
        ),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
