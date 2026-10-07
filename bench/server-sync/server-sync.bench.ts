/**
 * Budgets (docs/12): empty delta p95 <= 10 ms, snapshot of 60k features <= 20 s, viewport query with the permission
 * predicate p95 <= 100 ms, a change visible in the next delta <= 1 s, run p95 <= 50 ms with the doorbell and the
 * sync service attached (the sync writes nothing per participant, so a run costs the same for 1 or 40 participants).
 * Also: memory stays flat while 60k features stream (heap after gc, first vs last pages).
 * Data: the seeded bench generator (60k features), baumkataster 1.0.0 with a row filter on trees
 * (`visible_when`: the assignee, or `verwaltung`). Run: npm test -- -c bench/vitest.config.ts bench/server-sync
 */
import { createVersionCache } from '../../packages/server/src/store/run/config-for';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { runInNewContext } from 'node:vm';
import { setFlagsFromString } from 'node:v8';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { assertBudget, DOC_BUDGETS, defineBudget, report, type Budget } from '../harness/budget.mjs';
import { generate } from '../generate/generate';
import { GOLDEN_DIR, loadSpec } from '../generate/spec';
import {
  compile,
  createGeo,
  decodePage,
  formApi,
  PLAN_MAX_RULE_DEPTH,
  TemplateFileSchema,
  type Actor,
  type FeatureId,
  type Json,
  type Key,
  type Run,
  type RunId,
  type SyncPage,
} from '../../packages/core/src';
import { createStore } from '../../packages/server/src/store';
import { createLogger } from '../../packages/server/src/log';
import {
  createDoorbell,
  createSyncService,
  withDoorbell,
  type Predicate,
} from '../../packages/server/src/sync';
import { createSyncHandlers } from '../../packages/server/src/http/sync';
import { createToolBell } from '../../packages/server/src/modules/chat/tool-bell';
import { goldenAssets } from '../../packages/core/src/testing/golden';
import { SYNC_PROTOCOL_VERSION } from '../../packages/core/src/sync/contract';

const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] as number;
const NOW = '2026-05-01T08:00:00.000Z';
const vera: Actor = { id: 'vera', kind: 'participant', roles: ['verwaltung' as Key] };

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

describe('bench: server sync', () => {
  it('empty delta, 60k snapshot, viewport, delta after a change, run p95 with the doorbell attached', async () => {
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

    const versions = createVersionCache(() => config);
    const service = createSyncService(db, {
      config: () => ({ version: 1, config }),
      at: () => config,
      versions,
      clock: { now: () => NOW },
      geo: createGeo(),
    });
    const bell = createDoorbell({ head: () => service.head(), pollMs: 0 });
    let n = 0;
    const uuid = (p: number): string =>
      `${String(p).padStart(8, '0')}-0000-7000-8000-${String(++n).padStart(12, '0')}`;
    const store = withDoorbell(
      createStore(db, {
        clock: { now: () => NOW },
        log: createLogger({ sink: () => undefined, now: () => Date.now() }),
        ids: { runId: () => uuid(2) as RunId, featureId: () => uuid(3) as FeatureId },
        geo: createGeo(),
        limits: { ruleDepth: PLAN_MAX_RULE_DEPTH },
        config: (v) => (v === 1 ? config : undefined),
        versions,
        form: formApi,
      }),
      bell,
    );
    for (let i = 0; i < 3; i++) bell.subscribe(() => undefined); // devices listening on the doorbell
    const handlers = createSyncHandlers({
      log: createLogger({ sink: () => undefined, now: () => Date.now() }),
      project: (key) => ({ id: 'p', key }),
      rolesFor: () => [],
      service: () => service,
      doorbell: () => bell,
      toolBell: createToolBell(),
    });
    const principal = (actor: Actor) => ({
      kind: 'participant' as const,
      id: actor.id,
      projectId: 'p',
      roles: actor.roles,
    });
    const pull = async (actor: Actor, query: string): Promise<SyncPage> => {
      const res = handlers.sync({
        request: new Request(`http://x/sync?${query}`, { headers: { 'accept-encoding': 'gzip' } }),
        project: 'p',
        principal: principal(actor),
      });
      if (res.status !== 200) throw new Error(`${res.status} ${await res.text()}`);
      return decodePage(JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8')));
    };

    // The participant with the most trees of their own.
    const owner = db
      .prepare<{ who: string; c: number }>(
        `SELECT json_extract(properties, '$.zustaendig') AS who, count(*) AS c FROM features
         WHERE type = 'baum' AND lifecycle IN ('active','completed') AND who IS NOT NULL GROUP BY who ORDER BY c DESC, who LIMIT 1`,
      )
      .get();
    if (!owner) throw new Error('no assigned trees in the bench data');
    const anna: Actor = { id: owner.who, kind: 'participant', roles: ['kontrolle' as Key] };
    // another real participant of the fixture project (the plan refuses an assignee who is none)
    const second = db
      .prepare<{ id: string }>(`SELECT id FROM participants WHERE id <> ? ORDER BY id LIMIT 1`)
      .get(owner.who);
    if (!second) throw new Error('the bench data has no second participant');
    const other: Actor = { id: second.id, kind: 'participant', roles: ['kontrolle' as Key] };

    // --- snapshot of 60k features as the worst case (verwaltung sees everything), memory sampled after gc
    const t0 = performance.now();
    let rows = 0;
    let pages = 0;
    let pin: number | undefined;
    let after = 0;
    let scope = '';
    const heap: number[] = [];
    for (;;) {
      const q = `since=0&scope=${scope}&v=${SYNC_PROTOCOL_VERSION}` + (pin === undefined ? '' : `&after=${after}&pin=${pin}`);
      const page = await pull(vera, q);
      scope = page.header.scopeFingerprint;
      pin = page.header.head;
      after = page.header.cursor;
      rows += page.features.length;
      pages++;
      if (pages % 10 === 0) {
        gc();
        heap.push(process.memoryUsage().heapUsed / 1e6);
      }
      if (!page.header.more) break;
    }
    const snapshotS = (performance.now() - t0) / 1000;
    const liveFeatures = (
      db
        .prepare<{ n: number }>(
          "SELECT count(*) AS n FROM features WHERE lifecycle IN ('active','completed')",
        )
        .get() as { n: number }
    ).n;
    expect(rows).toBe(liveFeatures);
    expect(rows).toBeGreaterThanOrEqual(60_000);
    const growth = Math.max(...heap.slice(2)) - Math.min(...heap.slice(0, 2));
    console.log(
      `server sync: snapshot ${rows} features in ${pages} pages, ${snapshotS.toFixed(1)} s; heap after gc ${heap
        .map((h) => h.toFixed(0))
        .join('/')} MB (growth ${growth.toFixed(0)} MB)`,
    );
    assertBudget(report(DOC_BUDGETS['snapshot-60k'] as Budget, Number(snapshotS.toFixed(1))));
    expect(growth).toBeLessThan(40); // pages are independent: memory does not grow with the snapshot

    // --- empty delta p95 (handler, gzip and all)
    const annaScope = (await pull(anna, `since=0&scope=&v=${SYNC_PROTOCOL_VERSION}&limit=1`)).header.scopeFingerprint;
    const head = service.head();
    for (let i = 0; i < 20; i++) await pull(anna, `since=${head}&scope=${annaScope}&v=${SYNC_PROTOCOL_VERSION}`);
    const empties: number[] = [];
    for (let i = 0; i < 400; i++) {
      const t = performance.now();
      const page = await pull(anna, `since=${head}&scope=${annaScope}&v=${SYNC_PROTOCOL_VERSION}`);
      empties.push(performance.now() - t);
      expect(page.features).toHaveLength(0);
    }
    const empty = p95(empties);
    console.log(`server sync: empty delta p95 ${empty.toFixed(2)} ms`);
    assertBudget(report(DOC_BUDGETS['empty-delta-p95'] as Budget, Number(empty.toFixed(2))));

    // --- viewport query with the permission predicate (R*Tree join + the sync's own predicate)
    const trees = db
      .prepare<{ x: number; y: number }>(
        "SELECT anchor_lon AS x, anchor_lat AS y FROM features WHERE type = 'baum' AND lifecycle IN ('active','completed') ORDER BY id LIMIT 4000",
      )
      .all();
    const pred: Predicate = service.visible(anna, 'f');
    const bbox = db.prepare<{ id: string }>(
      `SELECT f.id FROM feature_bbox r JOIN features f ON f.rowid = r.rid
       WHERE r.minx <= ? AND r.maxx >= ? AND r.miny <= ? AND r.maxy >= ? AND f.lifecycle IN ('active','completed') AND ${pred.sql}`,
    );
    const view: number[] = [];
    for (let i = 0; i < 300; i++) {
      const c = trees[(i * 13) % trees.length] as { x: number; y: number };
      const t = performance.now();
      bbox.all(c.x + 0.003, c.x - 0.003, c.y + 0.003, c.y - 0.003, ...(pred.params as (string | number)[]));
      view.push(performance.now() - t);
    }
    const viewport = p95(view);
    console.log(`server sync: viewport query with permission predicate p95 ${viewport.toFixed(2)} ms`);
    assertBudget(
      report(
        defineBudget({
          id: 'sync-viewport-clipped',
          limit: 100,
          unit: 'ms',
          derivedFrom: 'bbox-query-p95: the same query clipped by the participant predicate',
          device: 'server',
        }),
        Number(viewport.toFixed(2)),
      ),
    );

    // --- runs with the doorbell attached; a reassignment produces a tombstone in the old assignee's next delta
    const own = db
      .prepare<{ id: string }>(
        `SELECT id FROM features WHERE type = 'baum' AND lifecycle IN ('active','completed') AND json_extract(properties, '$.zustaendig') = ? LIMIT 60`,
      )
      .all(anna.id);
    expect(own.length).toBeGreaterThan(20);
    const run = (id: string, task: string, who: Actor, input: Record<string, Json>, feature: string): Run =>
      ({
        id,
        task: task as Key,
        actor: who,
        configVersion: 1,
        input,
        featureId: feature as FeatureId,
      }) as Run;
    const runMs: number[] = [];
    const visible: number[] = [];
    let tombstones = 0;
    let arrived = 0;
    const cursor = { anna: service.head(), other: service.head() };
    for (let i = 0; i < own.length; i++) {
      const tree = (own[i] as { id: string }).id;
      const t = performance.now();
      const res = store.submit(run(uuid(1), 'zuweisen', vera, { zustaendig: other.id }, tree));
      runMs.push(performance.now() - t);
      if (res.outcome !== 'accepted') throw new Error(`${res.refusal.code}: ${res.refusal.message}`);
      const a = await pull(anna, `since=${cursor.anna}&scope=${annaScope}&v=${SYNC_PROTOCOL_VERSION}`);
      const o = await pull(other, `since=${cursor.other}&scope=&v=${SYNC_PROTOCOL_VERSION}`);
      visible.push(performance.now() - t);
      cursor.anna = a.header.cursor;
      cursor.other = o.header.cursor;
      if (a.tombstones.some((x) => x.kind === 'feature' && x.id === tree)) tombstones++;
      if (o.features.some((f) => f.id === tree)) arrived++;
    }
    expect(tombstones).toBe(own.length);
    expect(arrived).toBe(own.length);
    const runP95 = p95(runMs);
    const visibleP95 = p95(visible);
    console.log(
      `server sync: ${own.length} reassignments, run p95 ${runP95.toFixed(1)} ms, run to delta on both devices p95 ${visibleP95.toFixed(1)} ms, 3 doorbell listeners, tombstones ${tombstones}`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'sync-run-with-doorbell',
          limit: 50,
          unit: 'ms',
          derivedFrom: 'run-endpoint-p95: a run with the sync service and the doorbell attached',
          device: 'server',
        }),
        Number(runP95.toFixed(1)),
      ),
    );
    assertBudget(
      report(
        defineBudget({
          id: 'sync-delta-after-run',
          limit: 1000,
          unit: 'ms',
          derivedFrom: 'delta-visible: run commit until two devices hold the change (tombstone and row)',
          device: 'server',
        }),
        Number(visibleP95.toFixed(1)),
      ),
    );
    db.close();
  }, 600_000);
});
