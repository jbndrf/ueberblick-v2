/**
 * Budget (docs/12 "Viewport/bbox query p95 (60k)" <= 100 ms), measured through the OGC items handler: session check,
 * the sync scope's row filter, the R*Tree bbox join, keyset paging, GeoJSON serialisation. Worst cases as well: a
 * rare feature type (no index on `type`), a participant who sees few rows, a deep keyset page.
 * Data: the seeded bench generator (60k features), baumkataster with a row filter on trees (assignee, or `verwaltung`).
 * Run: npm run bench (see bench/README.md for one folder)
 */
import { createVersionCache } from '../../packages/server/src/store/run/config-for';
import { goldenAssets } from '../../packages/core/src/testing/golden';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { generate } from '../generate/generate';
import { GOLDEN_DIR, loadSpec } from '../generate/spec';
import { compile, createGeo, TemplateFileSchema, type Key } from '../../packages/core/src';
import { createSyncService } from '../../packages/server/src/sync';
import { createOgcHandlers } from '../../packages/server/src/http/ogc';

const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] as number;
const NOW = '2026-05-01T08:00:00.000Z';

describe('bench: OGC API Features items', () => {
  it('items with bbox p95 on 60k features, and the worst cases', async () => {
    const { db } = generate({ seed: 4711, features: 60_000 });
    const parsed = TemplateFileSchema.parse(
      parse(readFileSync(resolve(GOLDEN_DIR, loadSpec().template), 'utf8')),
    );
    const baum = parsed.types?.['baum'];
    if (!baum) throw new Error('template has no baum');
    const scoped = TemplateFileSchema.parse({
      ...parsed,
      types: {
        ...parsed.types,
        baum: {
          ...baum,
          permissions: {
            ...baum.permissions,
            visible_when: "self.zustaendig == actor.id || 'verwaltung' in actor.roles",
          },
        },
      },
    });
    const compiled = compile(scoped, { assets: goldenAssets });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
    const config = compiled.config;
    const clock = { now: () => NOW };
    const service = createSyncService(db, {
      config: () => ({ version: 1, config }),
      at: () => config,
      versions: createVersionCache(() => config),
      clock,
      geo: createGeo(),
    });

    let who = { id: 'vera', roles: ['verwaltung' as Key] };
    const handlers = createOgcHandlers({
      auth: {
        authenticate: () => ({ kind: 'admin', id: who.id }) as never,
        toActor: () => ({ id: who.id, kind: 'admin', roles: who.roles }),
        rolesFor: () => who.roles,
      },
      project: (key) => ({ id: 'p', key }),
      db: () => db,
      store: () => {
        throw new Error('reads do not use the store');
      },
      sync: () => service,
      deployed: () => ({ version: 1, config }),
      clock,
      ids: { runId: () => 'x' as never, featureId: () => 'y' as never },
    });
    const get = async (
      path: string,
    ): Promise<{ features: unknown[]; links: { rel: string; href: string }[] }> => {
      const r = await handlers.handle(
        new Request(`http://x/api/p/p/ogc/${path}`, { headers: { cookie: 'ub_session_participant=s' } }),
        { params: { project: 'p', path: path.split('?')[0] as string } },
      );
      if (r.status !== 200) throw new Error(`${r.status} ${await r.text()}`);
      return (await r.json()) as { features: unknown[]; links: { rel: string; href: string }[] };
    };
    const time = async (n: number, path: (i: number) => string): Promise<number[]> => {
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        const p = path(i);
        const t = performance.now();
        await get(p);
        out.push(performance.now() - t);
      }
      return out;
    };

    const trees = db
      .prepare<{ x: number; y: number }>(
        "SELECT anchor_lon AS x, anchor_lat AS y FROM features WHERE type = 'baum' AND lifecycle IN ('active','completed') ORDER BY id LIMIT 4000",
      )
      .all();
    const box = (i: number): string => {
      const c = trees[(i * 13) % trees.length] as { x: number; y: number };
      return `collections/baum/items?limit=100&bbox=${c.x - 0.003},${c.y - 0.003},${c.x + 0.003},${c.y + 0.003}`;
    };
    await time(30, box); // warm-up
    const viewport = p95(await time(300, box));
    console.log(`server ogc: items with bbox p95 ${viewport.toFixed(1)} ms (verwaltung, limit 100)`);
    assertBudget(
      report(
        defineBudget({
          id: 'ogc-items-bbox-p95',
          limit: 100,
          unit: 'ms',
          derivedFrom: 'bbox-query-p95: items with a bbox through the OGC handler',
          device: 'server',
        }),
        Number(viewport.toFixed(1)),
      ),
    );

    // worst cases, reported (not budgeted separately except the first page of a big collection)
    const firstPage = p95(await time(40, () => 'collections/baum/items?limit=100'));
    let deepHref = 'collections/baum/items?limit=100&cursor=59000';
    const deep = p95(await time(40, () => deepHref));
    const rare = p95(await time(20, () => 'collections/flaeche/items?limit=100'));
    who = { id: 'somebody-else', roles: ['kontrolle' as Key] };
    const few = p95(await time(10, () => 'collections/baum/items?limit=100'));
    const fewBox = p95(await time(30, box));
    void deepHref;
    deepHref = '';
    console.log(
      `server ogc: first page ${firstPage.toFixed(1)} ms, deep keyset page ${deep.toFixed(1)} ms, rare type ${rare.toFixed(1)} ms, participant with few rows: page ${few.toFixed(1)} ms, bbox ${fewBox.toFixed(1)} ms`,
    );
    report(
      defineBudget({
        id: 'ogc-items-worst-p95',
        limit: 100,
        unit: 'ms',
        derivedFrom: 'bbox-query-p95: worst of first page, deep page, rare type, few-rows participant',
        device: 'server',
      }),
      Number(Math.max(firstPage, deep, rare, few).toFixed(1)),
    );
  }, 300_000);
});
