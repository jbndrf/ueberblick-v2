/**
 * Budget (docs/12 "Run endpoint"): one run including rules, p95 <= 50 ms at 60k features, now through the WIRED
 * runtime (WP-137): the shared store with its timers hook (rescheduling in the run transaction), the doorbell (a
 * listener is subscribed, so every run rings a head lookup) and the config cache. Also the timers loop's own cost:
 * a tick with nothing due must not scan the timers table (background, but it runs on a 1-vCPU box every N seconds).
 * Run: npm test -- -c bench/vitest.config.ts bench/server-run/wired
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../packages/server/src/log';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { generate } from '../generate/generate';
import { GOLDEN_DIR, loadSpec } from '../generate/spec';
import { TemplateFileSchema, type Actor, type Key, type Run, type RunId } from '../../packages/core/src';
import { benchBlobs } from './seed-config';
import { embedRefs } from '../../scripts/embed-refs.mjs';
import { deploy } from '../../packages/server/src/deploy';
import {
  createProjectServices,
  projectStoresFor,
  type ProjectStoresDeps,
} from '../../packages/server/src/http/shared';

const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] as number;
const anna: Actor = { id: 'anna', kind: 'participant', roles: ['kontrolle' as Key] };

describe('bench: the wired run path and the timers tick at 60k features', () => {
  it('run p95 through shared store + timers hook + doorbell, and an idle tick', () => {
    const { db } = generate({ seed: 4711, features: 60_000 });
    // deploy takes only self-contained files: embed the golden `$ref` styles first, as every ingestion point does (WP-577)
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const template = TemplateFileSchema.parse(
      embedRefs(parse(readFileSync(resolve(GOLDEN_DIR, loadSpec().template), 'utf8')), root),
    );
    const clock = { now: () => '2026-05-01T08:00:00.000Z' };
    const deployed = deploy(db, template, 'bench', { clock });
    if (!deployed.ok) throw new Error(JSON.stringify(deployed));
    const version = deployed.version;

    const projectDb = (): typeof db => db;
    const rt: ProjectStoresDeps = {
      clock,
      log: createLogger({ sink: () => undefined, now: () => 0 }),
      projectDb,
      blobs: benchBlobs(),
      hooks: (p) => services.hooks(p),
      doorbell: (k) => services.doorbell(k),
    };
    const services = createProjectServices({
      clock,
      log: createLogger({ sink: () => undefined, now: () => 0 }),
      projectDb,
      store: (k) => projectStoresFor(rt)(k),
    });
    const store = projectStoresFor(rt)('bench');
    const heard: number[] = [];
    const unsubscribe = services.doorbell('bench').subscribe((m) => heard.push(m.to));

    const t0 = performance.now();
    const scheduled = services.timers('bench').rebuild();
    const rebuildMs = performance.now() - t0;

    const trees = db
      .prepare<{ id: string }>(
        `SELECT f.id AS id FROM features f
         JOIN edges e ON e.from_id = f.id AND e.relation = 'flaeche'
         WHERE f.type = 'baum' AND f.lifecycle IN ('active','completed') AND json_extract(f.properties, '$.stage') != 'erledigt'
         LIMIT 1000`,
      )
      .all();
    expect(trees.length).toBeGreaterThan(450);
    let n = 0;
    const submit = (i: number, id: string): number => {
      const run = {
        id: `00000001-0000-7000-8000-${String(++n).padStart(12, '0')}` as RunId,
        task: 'kontrolle' as Key,
        actor: anna,
        configVersion: version,
        featureId: id,
        input: { vitalitaet: i % 2 === 0 ? 'v3' : 'v2', befund: `bench ${i}` },
      } as unknown as Run;
      const t = performance.now();
      const r = store.submit(run);
      const ms = performance.now() - t;
      if (r.outcome !== 'accepted') throw new Error(JSON.stringify(r));
      return ms;
    };
    for (let i = 0; i < 30; i++) submit(i, (trees[i] as { id: string }).id);
    const runs: number[] = [];
    for (let i = 0; i < 400; i++) runs.push(submit(i, (trees[30 + i] as { id: string }).id));
    expect(heard.length).toBeGreaterThanOrEqual(430); // every accepted run rang the bell

    const timerRows = (db.prepare<{ n: number }>('SELECT count(*) n FROM timers').get() as { n: number }).n;
    const idle: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t = performance.now();
      services.timers('bench').tick('2026-05-01T08:00:00.000Z');
      idle.push(performance.now() - t);
    }
    const run95 = p95(runs);
    const tick95 = p95(idle);
    console.log(
      `wired run p95 ${run95.toFixed(1)} ms (timers hook + doorbell, ${timerRows} timer rows); idle tick p95 ${tick95.toFixed(2)} ms; rebuild after deploy ${rebuildMs.toFixed(0)} ms for ${scheduled} rows`,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'run-endpoint-wired-p95',
          limit: 50,
          unit: 'ms',
          derivedFrom:
            'run-endpoint-p95: the same row through the runtime wiring, timers hook and doorbell (WP-137)',
          device: 'server',
        }),
        Number(run95.toFixed(1)),
      ),
    );
    assertBudget(
      report(
        defineBudget({
          id: 'timers-idle-tick-p95',
          limit: 5,
          unit: 'ms',
          derivedFrom: 'run-endpoint-p95: a tick with nothing due must stay far below one run (WP-137)',
          device: 'server',
        }),
        Number(tick95.toFixed(2)),
      ),
    );
    unsubscribe(); // stops the doorbell's poll timer before the database closes
    db.close();
  }, 300_000);
});
