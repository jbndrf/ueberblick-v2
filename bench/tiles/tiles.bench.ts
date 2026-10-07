/**
 * Budgets (docs/12, WP-369), derived from the run-endpoint row (<= 50 ms p95) and the 16 ms map frame:
 * - `tile-proxy-cached-p95`: a tile that is in the disk cache is served through the real handler (session, audience,
 *   source resolution, one file read, headers) in <= 10 ms p95;
 * - `tile-proxy-miss-overhead-p95`: a cold miss against an upstream that answers at once (fake) costs the proxy itself
 *   (limiter, sniff, atomic write, index) <= 25 ms p95, so the wait for a first tile is the provider's, not ours.
 * Run: npm test -- -c bench/vitest.config.ts bench/tiles
 */
import { rmSync } from 'node:fs';
import { describe, it } from 'vitest';
import type { TemplateFile } from '@ueberblick/core';
import type { Principal } from '../../packages/server/src/auth/contract';
import { SESSION_COOKIES } from '../../packages/server/src/auth/params';
import { createTileHandlers } from '../../packages/server/src/http/tiles/handlers';
import { golden } from '../../packages/server/src/store/run/testkit';
import { fakeUpstream, kit, ok, png } from '../../packages/server/src/tiles/testkit';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

const TILES = 2000;
const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] as number;
const budget = (id: string, limit: number) =>
  defineBudget({
    id,
    limit,
    unit: 'ms',
    derivedFrom: `run-endpoint-p95: ${id} is a fraction of the run endpoint budget`,
    device: 'server',
    thread: 'main',
  });

describe('bench: tile proxy', () => {
  it('cached-tile p95 and cold-miss overhead p95', async () => {
    const file: TemplateFile = structuredClone(golden('musterstadt-plain').file);
    file.map = {
      layers: { osm: { label: { de: 'OSM' }, kind: 'base', source: { type: 'preset', preset: 'osm' } } },
    };
    const body = png('x'.repeat(15_000)); // an average raster tile
    const up = fakeUpstream(() => ok(body));
    const { service, root } = kit(up);
    try {
      const handlers = createTileHandlers({
        auth: {
          authenticate: (id: string | null) =>
            id === null ? null : ({ kind: 'participant', id, projectId: 'p1' } as unknown as Principal),
          toActor: (p: { id: string }) => ({ id: p.id, kind: 'participant', roles: [] }),
          rolesFor: () => [],
        } as never,
        project: (key) => (key === 'demo' ? { id: 'p1', key } : undefined),
        deployed: () => ({ version: 1, config: { file } as never }),
        service,
      });
      const get = (i: number) =>
        handlers.tile(
          new Request(`http://x/api/p/demo/tiles/osm/12/${i % 64}/${Math.floor(i / 64)}`, {
            headers: { cookie: `${SESSION_COOKIES.participant}=u` },
          }),
          {
            params: {
              project: 'demo',
              layer: 'osm',
              z: '12',
              x: String(i % 64),
              y: String(Math.floor(i / 64)),
            },
          },
        );
      const time = async (i: number): Promise<number> => {
        const t = performance.now();
        const r = await get(i);
        await r.arrayBuffer();
        return performance.now() - t;
      };
      const cold: number[] = [];
      for (let i = 0; i < TILES; i++) cold.push(await time(i));
      const warm: number[] = [];
      for (let i = 0; i < TILES; i++) warm.push(await time((i * 7919) % TILES));
      const [miss, hit] = [p95(cold), p95(warm)];
      console.log(
        `tile proxy: cold miss p95 ${miss.toFixed(2)} ms, cached p95 ${hit.toFixed(3)} ms, upstream calls ${up.calls.length}`,
      );
      assertBudget(report(budget('tile-proxy-cached-p95', 10), hit));
      assertBudget(report(budget('tile-proxy-miss-overhead-p95', 25), miss));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
