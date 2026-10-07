/**
 * Budget (docs/12): a tile lookup from an offline pack fits the map frame (16 ms at the x4 phone factor, so 4 ms
 * measured), and the cold first lookup (header and directory read) stays under the long-task row (100 ms at x4).
 * The pack file is a seeded 150 x 150 tile grid at z14 (22,500 tiles, 1 KB each, one root directory) read through the
 * real protocol handler and the real `pmtiles` reader; the byte source is memory, so OPFS slice latency is not
 * included (the browser bench measures that). Nothing is committed.
 * Run: npm test -- -c bench/vitest.config.ts client-packs
 */
import { describe, it } from 'vitest';
import { assertBudget, defineBudget, docBudget, report } from '../harness/budget.mjs';
import { createPackProtocol } from '../../packages/ui/src/map/maplibre/packs';
import { buildPmtiles, fixtureFile } from '../../packages/ui/src/map/maplibre/packs-fixture.testing';

const GRID = 150;
const LOOKUPS = 2000;
const lookup = defineBudget({
  id: 'pack-tile-lookup-p95',
  limit: 16,
  unit: 'ms',
  derivedFrom: 'long-task / map frame: a pack tile lookup fits one 16 ms frame',
  device: 'x4',
  thread: 'main',
});

describe('bench: offline pack tile lookup', () => {
  it('cold first lookup and warm p95', async () => {
    const tiles = [];
    for (let x = 0; x < GRID; x++)
      for (let y = 0; y < GRID; y++)
        tiles.push({ z: 14, x: 8000 + x, y: 5000 + y, data: new Uint8Array(1024).fill((x + y) & 255) });
    const bytes = buildPmtiles(tiles);
    const protocol = createPackProtocol({
      packs: { layerFiles: async () => [fixtureFile('h/osm', 'osm', bytes, 14)] },
      fetchTile: async () => undefined,
    });
    const get = (i: number): Promise<unknown> =>
      protocol.handler(
        { url: `ubtile://osm/14/${8000 + ((i * 7919) % GRID)}/${5000 + ((i * 104729) % GRID)}` },
        new AbortController(),
      );

    const t0 = performance.now();
    await get(0);
    const cold = performance.now() - t0;
    const times: number[] = [];
    for (let i = 1; i <= LOOKUPS; i++) {
      const t = performance.now();
      await get(i);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)] ?? Infinity;
    console.log(
      `pack file ${(bytes.length / 1e6).toFixed(1)} MB, ${tiles.length} tiles; cold ${cold.toFixed(2)} ms, warm p50 ${(times[LOOKUPS >> 1] ?? 0).toFixed(3)} ms`,
    );
    assertBudget(
      report(docBudget('long-task', { device: 'x4', thread: 'main', id: 'pack-first-lookup' }), cold),
    );
    assertBudget(report(lookup, p95));
  }, 60_000);
});
