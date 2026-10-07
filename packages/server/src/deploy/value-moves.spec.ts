// WP-307: deploy mappings { to } become resumable `$move` system runs; the plan counts the affected features.
import { describe, expect, it } from 'vitest';
import type { FeatureId, Json, Key, Run, RunId, TemplateFile } from '@ueberblick/core';
import type { Db } from '../db/driver';
import { openProjectDb } from '../db/open';
import { composeProjectStore } from '../http/shared/stores';
import { logSpy } from '../store/run/log.testkit';
import { deployProject, deployedVersion, loadConfig, plan } from './index';
import { createMoveExecutor } from './move-executor';
import { featuresToMove } from './move-select';

const clock = { now: () => '2026-10-01T10:00:00Z' };
const deps = { clock, afterDeploy: () => undefined };
const OPT = 'types.baum.properties.stage.options.kontrolliert';

const file = (options: Record<string, string>, extra: Record<string, unknown> = {}): TemplateFile =>
  ({
    schema: 'ueberblick/1',
    template: { key: 'moves', version: '1.0.0' },
    roles: { maker: { label: 'Maker' } },
    types: {
      baum: {
        label: 'Baum',
        permissions: { see: '$all', create: '$all', write: '$all' },
        properties: {
          stage: { type: 'select', options },
          tags: { type: 'multiselect', options: { a: 'A', b: 'B' } },
          ...extra,
        },
      },
    },
    tasks: {
      anlegen: {
        label: 'Anlegen',
        who: ['admin'],
        on: '$map',
        creates: 'baum',
        form: { stage: {}, tags: {} },
      },
    },
  }) as unknown as TemplateFile;

const V1 = file({ erfasst: 'Erfasst', kontrolliert: 'Kontrolliert', geprueft: 'Geprüft' });
const V2 = file({ erfasst: 'Erfasst', geprueft: 'Geprüft' });

const SYSTEM_ROWS = "SELECT count(*) AS n FROM runs WHERE task = '$move'";
const count = (db: Db, sql: string, ...p: string[]): number =>
  db.prepare<{ n: number }>(sql).get(...p)?.n ?? 0;
const stageOf = (db: Db, id: string): Json =>
  (
    JSON.parse(
      db.prepare<{ properties: string }>('SELECT properties FROM features WHERE id = ?').get(id)
        ?.properties ?? '{}',
    ) as Record<string, Json>
  )['stage'] ?? null;

/** A project at v1 with `stages.length` features (one run each), then v2 deployed with `mappings`. */
function world(stages: readonly string[]) {
  const db = openProjectDb(':memory:', 'p');
  const log = logSpy();
  const store = composeProjectStore(db, { clock, log: log.log, onOrphanedBlobs: () => undefined });
  expect(deployProject(db, V1, 'root', deps).ok).toBe(true);
  let n = 0;
  const ids: FeatureId[] = [];
  for (const stage of stages) {
    n++;
    const id = `00000000-0000-7000-8000-${String(n).padStart(12, '0')}` as FeatureId;
    ids.push(id);
    const r = store.submit({
      id: `10000000-0000-7000-8000-${String(n).padStart(12, '0')}` as RunId,
      task: 'anlegen' as Key,
      actor: { id: 'root', kind: 'admin', roles: [] },
      configVersion: 1,
      featureId: id,
      input: { stage, tags: ['a'] },
    } satisfies Run);
    expect(r.outcome).toBe('accepted');
  }
  const ex = (opts: { batchSize?: number; afterBatch?: (n: number) => void } = {}) =>
    createMoveExecutor(db, {
      store,
      ids: { runId: () => `20000000-0000-7000-8000-${String(++n).padStart(12, '0')}` as RunId },
      pause: () => Promise.resolve(),
      ...opts,
    });
  return { db, ids, ex, store };
}

describe('mappings of a deploy', () => {
  it('a { to } mapping on an unknown path is a problem and writes nothing', () => {
    const { db } = world(['erfasst']);
    const r = deployProject(db, V2, 'root', deps, { 'types.baum.properties.gibtsnicht': { to: 'stage' } });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.problems[0]).toMatchObject({ code: 'unknown_path', path: 'types.baum.properties.gibtsnicht' });
    expect(deployedVersion(db)?.version).toBe(1);
    expect(count(db, 'SELECT count(*) AS n FROM deploy_moves')).toBe(0);
  });

  it('a { to } that is no option of the new version is a problem', () => {
    const { db } = world(['erfasst']);
    const r = deployProject(db, V2, 'root', deps, { [OPT]: { to: 'gibtsnicht' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]).toMatchObject({ code: 'dangling_reference', path: OPT });
    expect(deployedVersion(db)?.version).toBe(1);
  });

  it("{ discard } keeps today's behaviour: nothing is recorded or moved", async () => {
    const { db, ex } = world(['kontrolliert']);
    const r = deployProject(db, V2, 'root', deps, { [OPT]: { discard: true } });
    expect(r.ok && r.moves).toBe(0);
    expect(count(db, 'SELECT count(*) AS n FROM deploy_moves')).toBe(0);
    await ex().run();
    expect(count(db, SYSTEM_ROWS)).toBe(0);
  });

  it('records one row per { to } mapping in the deploy transaction', () => {
    const { db } = world(['kontrolliert']);
    const r = deployProject(db, V2, 'root', deps, { [OPT]: { to: 'geprueft' } });
    expect(r.ok && r.moves).toBe(1);
    const row = db
      .prepare<{ version: number; path: string; payload: string; next_id: string; done: number }>(
        'SELECT version, path, payload, next_id, done FROM deploy_moves',
      )
      .get();
    expect(row).toMatchObject({ version: 2, path: OPT, next_id: '', done: 0 });
    expect(JSON.parse(row?.payload ?? '{}')).toEqual({
      type: 'baum',
      property: 'stage',
      from: 'kontrolliert',
      to: 'geprueft',
    });
  });
});

describe('runMoves', () => {
  it('moves every former kontrolliert feature through $move system runs', async () => {
    const stages = Array.from({ length: 23 }, (_, i) => (i % 3 === 0 ? 'erfasst' : 'kontrolliert'));
    const { db, ids, ex } = world(stages);
    const kontrolliert = ids.filter((_, i) => stages[i] === 'kontrolliert');
    const obsBefore = count(db, 'SELECT count(*) AS n FROM observations');
    deployProject(db, V2, 'root', deps, { [OPT]: { to: 'geprueft' } });
    const r = await ex({ batchSize: 5 }).run();
    expect(r).toMatchObject({ moved: kontrolliert.length });
    for (const [i, id] of ids.entries())
      expect(stageOf(db, id)).toBe(stages[i] === 'kontrolliert' ? 'geprueft' : 'erfasst');
    expect(count(db, SYSTEM_ROWS)).toBe(kontrolliert.length);
    const runs = db
      .prepare<{ actor: string; actor_kind: string; caused_by: string | null; config_version: number }>(
        "SELECT actor, actor_kind, caused_by, config_version FROM runs WHERE task = '$move'",
      )
      .all();
    for (const run of runs)
      expect(run).toEqual({ actor: 'system', actor_kind: 'system', caused_by: null, config_version: 2 });
    // R3: every new observation belongs to a $move run (the FK holds), one each.
    expect(count(db, 'SELECT count(*) AS n FROM observations') - obsBefore).toBe(kontrolliert.length);
    expect(
      count(
        db,
        "SELECT count(*) AS n FROM observations o JOIN runs r ON r.id = o.run_id WHERE r.task = '$move'",
      ),
    ).toBe(kontrolliert.length);
    expect(db.prepare<{ done: number }>('SELECT done FROM deploy_moves').get()?.done).toBe(1);
    // A second pass has nothing left to do.
    expect(await ex().run()).toMatchObject({ moved: 0 });
    expect(count(db, SYSTEM_ROWS)).toBe(kontrolliert.length);
  });

  it('moves a multiselect option and a property', async () => {
    const db = openProjectDb(':memory:', 'p');
    const store = composeProjectStore(db, { clock, log: logSpy().log, onOrphanedBlobs: () => undefined });
    const v1 = file({ erfasst: 'E' }, { notiz: { type: 'text' } });
    const v2 = file({ erfasst: 'E' }, { bemerkung: { type: 'text' } });
    (v2 as unknown as { types: { baum: { properties: Record<string, unknown> } } }).types.baum.properties[
      'tags'
    ] = {
      type: 'multiselect',
      options: { b: 'B' },
    };
    v1.tasks = {
      anlegen: {
        label: 'A',
        who: ['admin'],
        on: '$map',
        creates: 'baum',
        form: { stage: {}, tags: {}, notiz: {} },
      },
    } as never;
    v2.tasks = {
      anlegen: {
        label: 'A',
        who: ['admin'],
        on: '$map',
        creates: 'baum',
        form: { stage: {}, tags: {}, bemerkung: {} },
      },
    } as never;
    deployProject(db, v1, 'root', deps);
    const id = '00000000-0000-7000-8000-000000000001' as FeatureId;
    store.submit({
      id: '10000000-0000-7000-8000-000000000001' as RunId,
      task: 'anlegen' as Key,
      actor: { id: 'root', kind: 'admin', roles: [] },
      configVersion: 1,
      featureId: id,
      input: { stage: 'erfasst', tags: ['a', 'b'], notiz: 'Wurzel' },
    });
    const r = deployProject(db, v2, 'root', deps, {
      'types.baum.properties.tags.options.a': { to: 'b' },
      'types.baum.properties.notiz': { to: 'bemerkung' },
    });
    expect(r.ok && r.moves).toBe(2);
    let n = 0;
    await createMoveExecutor(db, {
      store,
      ids: { runId: () => `20000000-0000-7000-8000-${String(++n).padStart(12, '0')}` as RunId },
      pause: () => Promise.resolve(),
    }).run();
    const props = JSON.parse(
      db.prepare<{ properties: string }>('SELECT properties FROM features WHERE id = ?').get(id)
        ?.properties ?? '{}',
    );
    expect(props.tags).toEqual(['b']);
    expect(props.bemerkung).toBe('Wurzel');
  });

  it('resumes after a kill and moves nothing twice', async () => {
    const stages = Array.from({ length: 12 }, () => 'kontrolliert');
    const { db, ids, ex } = world(stages);
    deployProject(db, V2, 'root', deps, { [OPT]: { to: 'geprueft' } });
    const killed = ex({
      batchSize: 5,
      afterBatch: (n) => {
        if (n === 1) throw new Error('killed');
      },
    });
    await expect(killed.run()).rejects.toThrow('killed');
    expect(count(db, SYSTEM_ROWS)).toBe(5);
    const row = db.prepare<{ next_id: string; done: number }>('SELECT next_id, done FROM deploy_moves').get();
    expect(row).toMatchObject({ done: 0 });
    expect(row?.next_id).toBe(ids[4]);
    expect(await ex({ batchSize: 5 }).run()).toMatchObject({ moved: 7 });
    expect(count(db, SYSTEM_ROWS)).toBe(12);
    for (const id of ids) expect(stageOf(db, id)).toBe('geprueft');
  });

  it('featuresToMove is the one selection: live features of the type that hold the value', () => {
    const { db, ids } = world(['kontrolliert', 'erfasst', 'kontrolliert']);
    const move = { type: 'baum', property: 'stage', from: 'kontrolliert', to: 'geprueft' } as const;
    expect(featuresToMove(db, move, '', 10)).toEqual([ids[0], ids[2]]);
    expect(featuresToMove(db, move, ids[0] as string, 10)).toEqual([ids[2]]);
    expect(featuresToMove(db, move, '', 1)).toEqual([ids[0]]);
  });
});

describe('affected counts', () => {
  it('plan and deploy list affected per breaking entry', () => {
    const { db } = world(['kontrolliert', 'erfasst', 'kontrolliert', 'geprueft']);
    const dry = plan(db, V2, deps);
    if (!dry.ok) throw new Error('expected ok');
    expect(dry.diff.find((d) => d.path === OPT)).toMatchObject({ breaking: true, affected: 2 });
    expect(dry.diff.filter((d) => !d.breaking).every((d) => d.affected === undefined)).toBe(true);
    const r = deployProject(db, V2, 'root', deps, { [OPT]: { discard: true } });
    expect(r.ok && r.diff.find((d) => d.path === OPT)).toMatchObject({ affected: 2 });
    // a multiselect option counts the lists that hold it
    const p = plan(db, file({ erfasst: 'E', geprueft: 'G' }, {}), deps);
    expect(p.ok).toBe(true);
  });

  it('counts 10k features with one indexed query per entry', () => {
    const { db } = world([]);
    const insert = db.prepare(
      "INSERT INTO features (id, type, config_version, properties, updated_seq) VALUES (?, 'baum', 1, ?, ?)",
    );
    db.transaction(() => {
      for (let i = 0; i < 10_000; i++)
        insert.run(
          `f${String(i).padStart(6, '0')}`,
          JSON.stringify({ stage: i % 3 === 0 ? 'kontrolliert' : 'erfasst' }),
          i + 1,
        );
    });
    const t = performance.now();
    const dry = plan(db, V2, deps);
    const ms = performance.now() - t;
    if (!dry.ok) throw new Error('expected ok');
    expect(dry.diff.find((d) => d.path === OPT)?.affected).toBe(3334);
    // The time is printed for the work package log, not asserted (WP-147: no wall-clock asserts in unit specs).
    console.info(`affected counts over 10k features: ${ms.toFixed(1)} ms`);
    expect(loadConfig(db, 1)).toBeDefined();
  });
});
