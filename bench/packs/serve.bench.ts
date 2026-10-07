/**
 * Budgets (docs/12, WP-351), derived from the run-endpoint row (<= 50 ms p95) and from a 4G link:
 * - the device manifest at 50 packs x 3 layers answers in <= 50 ms p95 (handler, audience, JSON and ETag);
 * - a 50 MB pack file is served by range (1 MiB slices, as a PMTiles reader or a resuming download asks) at
 *   >= 25 MB/s on the server, so the server is never the slow side of a 4G download.
 * Run: npm test -- -c bench/vitest.config.ts bench/packs
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import type { Principal } from '../../packages/server/src/auth/contract';
import { SESSION_COOKIES } from '../../packages/server/src/auth/params';
import { openProjectDb } from '../../packages/server/src/db/open';
import { createPackHandlers } from '../../packages/server/src/http/packs/handlers';
import { markReady, packTargets, enqueuePacks, claimNext } from '../../packages/server/src/packs/store';
import { layerFile } from '../../packages/server/src/packs/build';
import { must, packFile } from '../../packages/server/src/packs/testkit';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

const NOW = '2026-10-02T10:00:00.000Z';
const PACKS = 50;
const LAYERS = ['l1', 'l2', 'l3'];
const FILE_BYTES = 50 * 1024 * 1024;
const SLICE = 1024 * 1024;
const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] as number;

describe('pack manifest and download', () => {
  it('manifest p95 at 50 packs x 3 layers, and range throughput on a 50 MB file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-serve-'));
    try {
      const packs = Object.fromEntries(
        Array.from(
          { length: PACKS },
          (
            _,
            i,
          ): [string, { bounds: [number, number, number, number]; min_zoom: number; max_zoom: number }] => [
            `p${String(i).padStart(2, '0')}`,
            { bounds: [7 + i / 100, 50, 7.05 + i / 100, 50.05], min_zoom: 10, max_zoom: 14 },
          ],
        ),
      );
      const file = packFile(packs, (f) => {
        const map = must(f.map);
        const basis = must(map.layers['basis']);
        map.layers = Object.fromEntries(LAYERS.map((l) => [l, { ...basis, label: { de: l } }]));
        for (const p of Object.values(must(map.packs))) p.layers = LAYERS;
      });
      const db = openProjectDb(':memory:', 'bench');
      enqueuePacks(db, file, NOW);
      for (;;) {
        const row = claimNext(db, NOW);
        if (row === undefined) break;
        markReady(db, row, { bytes: FILE_BYTES, sha256: 'a'.repeat(64), maxZoom: 14, tiles: 5000 }, NOW);
      }
      const target = must(packTargets(file)[0]);
      mkdirSync(join(dir, target.hash), { recursive: true });
      writeFileSync(layerFile(dir, target.hash, 'l1'), Buffer.alloc(FILE_BYTES, 7));

      const handlers = createPackHandlers({
        auth: {
          authenticate: () => ({ kind: 'participant', id: 'p', projectId: 'p1' }) as unknown as Principal,
          toActor: () => ({ id: 'p', kind: 'participant', roles: ['kontrolle'] }),
          rolesFor: () => [],
        } as never,
        project: () => ({ id: 'p1', key: 'bench' }),
        projectDb: () => db,
        deployed: () => ({ version: 1, config: { file } as never }),
        dir: () => dir,
      });
      const request = (path: string, headers: Record<string, string> = {}) =>
        new Request(`http://x/api/p/bench/packs${path}`, {
          headers: { cookie: `${SESSION_COOKIES.participant}=s`, ...headers },
        });

      const times: number[] = [];
      let packsListed = 0;
      for (let i = 0; i < 60; i++) {
        const t = performance.now();
        const res = await handlers.manifest(request(''), { params: { project: 'bench' } });
        const body = (await res.json()) as { packs: unknown[] };
        times.push(performance.now() - t);
        packsListed = body.packs.length;
      }
      if (packsListed !== PACKS)
        throw new Error(`the manifest lists ${packsListed} packs, expected ${PACKS}`);
      const manifestP95 = p95(times);
      console.info(
        `pack manifest: ${PACKS} packs x ${LAYERS.length} layers, p95 ${manifestP95.toFixed(2)} ms`,
      );
      assertBudget(
        report(
          defineBudget({
            id: 'pack-manifest-p95',
            limit: 50,
            unit: 'ms',
            derivedFrom:
              'run-endpoint-p95: a manifest read answers inside the run endpoint budget (docs/12, WP-351)',
            device: 'server',
          }),
          Number(manifestP95.toFixed(2)),
        ),
      );

      const params = { project: 'bench', hash: target.hash, file: 'l1.pmtiles' };
      const t0 = performance.now();
      let got = 0;
      for (let from = 0; from < FILE_BYTES; from += SLICE) {
        const res = await handlers.download(
          request(`/${target.hash}/l1.pmtiles`, { range: `bytes=${from}-${from + SLICE - 1}` }),
          { params },
        );
        if (res.status !== 206) throw new Error(`range read answered ${res.status}`);
        got += (await res.arrayBuffer()).byteLength;
      }
      const ms = performance.now() - t0;
      if (got !== FILE_BYTES) throw new Error(`read ${got} of ${FILE_BYTES} bytes`);
      console.info(
        `pack range read: 50 MB in ${ms.toFixed(0)} ms = ${((FILE_BYTES / 1e6 / ms) * 1000).toFixed(0)} MB/s`,
      );
      assertBudget(
        report(
          defineBudget({
            id: 'pack-range-read-50mb',
            limit: 2000,
            unit: 'ms',
            derivedFrom: '>= 25 MB/s served by range, faster than a 4G download (docs/12, WP-351)',
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
