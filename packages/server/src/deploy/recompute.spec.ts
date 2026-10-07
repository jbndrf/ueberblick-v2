// WP-312: a deploy that adds or changes `computed` recomputes the existing features with `$recompute` system runs (R3).
import { describe, expect, it } from 'vitest';
import type { FeatureId, Json, Key, Run, RunId, TemplateFile } from '@ueberblick/core';
import type { Db } from '../db/driver';
import { openProjectDb } from '../db/open';
import { composeProjectStore } from '../http/shared/stores';
import { logSpy } from '../store/run/log.testkit';
import { deployProject, deployedVersion, plan } from './index';
import { createMoveExecutor } from './move-executor';

const clock = { now: () => '2026-10-01T10:00:00Z' };
const deps = { clock, afterDeploy: () => undefined };

const file = (area: Record<string, unknown>): TemplateFile =>
  ({
    schema: 'ueberblick/1',
    template: { key: 'recompute', version: '1.0.0' },
    roles: { maker: { label: 'Maker' } },
    types: {
      parcel: {
        label: 'Parcel',
        permissions: { see: '$all', create: '$all', write: '$all' },
        properties: { width: { type: 'integer' }, height: { type: 'integer' }, area },
      },
    },
    tasks: {
      anlegen: {
        label: 'Anlegen',
        who: ['admin'],
        on: '$map',
        creates: 'parcel',
        form: { width: {}, height: {} },
      },
    },
  }) as unknown as TemplateFile;

const V1 = file({ type: 'integer' });
const V2 = file({ type: 'integer', computed: 'self.width * self.height' });
const V3 = file({ type: 'integer', computed: 'self.width * self.height + 1' });

const count = (db: Db, sql: string): number => db.prepare<{ n: number }>(sql).get()?.n ?? 0;
const areaOf = (db: Db, id: string): Json | null =>
  (
    JSON.parse(
      db.prepare<{ properties: string }>('SELECT properties FROM features WHERE id = ?').get(id)
        ?.properties ?? '{}',
    ) as Record<string, Json>
  )['area'] ?? null;

function world(total: number) {
  const db = openProjectDb(':memory:', 'p');
  const store = composeProjectStore(db, { clock, log: logSpy().log, onOrphanedBlobs: () => undefined });
  expect(deployProject(db, V1, 'root', deps).ok).toBe(true);
  const ids: FeatureId[] = [];
  for (let i = 1; i <= total; i++) {
    const id = `00000000-0000-7000-8000-${String(i).padStart(12, '0')}` as FeatureId;
    ids.push(id);
    const r = store.submit({
      id: `10000000-0000-7000-8000-${String(i).padStart(12, '0')}` as RunId,
      task: 'anlegen' as Key,
      actor: { id: 'root', kind: 'admin', roles: [] },
      configVersion: 1,
      featureId: id,
      input: { width: i, height: 2 },
    } satisfies Run);
    expect(r.outcome).toBe('accepted');
  }
  let n = 0;
  const executor = () =>
    createMoveExecutor(db, {
      store,
      ids: { runId: () => `20000000-0000-7000-8000-${String(++n).padStart(12, '0')}` as RunId },
      pause: () => Promise.resolve(),
    });
  return { db, ids, executor };
}

describe('deploy: computed', () => {
  it('records one $recompute row for a type whose computed was added, and none when it did not change', () => {
    const { db } = world(3);
    const r = deployProject(db, V2, 'root', deps);
    expect(r.ok && r.moves).toBe(1);
    const row = db.prepare<{ path: string; payload: string }>('SELECT path, payload FROM deploy_moves').get();
    expect(row?.path).toBe('types.parcel.properties.area.computed');
    expect(JSON.parse(row?.payload ?? '{}')).toEqual({ type: 'parcel', recompute: true });
    // The same file again is already deployed; a version that leaves `computed` alone records nothing.
    expect(deployProject(db, V2, 'root', deps).ok).toBe(true);
    expect(count(db, 'SELECT count(*) AS n FROM deploy_moves')).toBe(1);
  });

  it('records a row when the expression changes', () => {
    const { db } = world(1);
    deployProject(db, V2, 'root', deps);
    expect(deployProject(db, V3, 'root', deps).ok).toBe(true);
    expect(count(db, 'SELECT count(*) AS n FROM deploy_moves')).toBe(2);
  });

  it('records nothing for the first deploy (no features exist yet)', () => {
    const db = openProjectDb(':memory:', 'p');
    const r = deployProject(db, V2, 'root', deps);
    expect(r.ok && r.moves).toBe(0);
  });

  it('after runMoves every one of 1,000 features holds the computed value, written by $recompute runs', async () => {
    const { db, ids, executor } = world(1000);
    deployProject(db, V2, 'root', deps);
    const r = await executor().run();
    expect(r.moved).toBe(1000);
    expect(r.refused).toBe(0);
    ids.forEach((id, i) => expect(areaOf(db, id)).toBe((i + 1) * 2));
    expect(count(db, "SELECT count(*) AS n FROM runs WHERE task = '$recompute'")).toBe(1000);
    // R3: every computed observation belongs to a $recompute run.
    expect(
      count(
        db,
        `SELECT count(*) AS n FROM observations o JOIN runs r ON r.id = o.run_id
         WHERE o.property = 'area' AND r.task = '$recompute'`,
      ),
    ).toBe(1000);
    expect(deployedVersion(db)?.version).toBe(2);
  }, 120_000);

  it('a changed expression recomputes again, and an executor pass over current values writes no observation', async () => {
    const { db, ids, executor } = world(5);
    deployProject(db, V2, 'root', deps);
    await executor().run();
    deployProject(db, V3, 'root', deps);
    await executor().run();
    ids.forEach((id, i) => expect(areaOf(db, id)).toBe((i + 1) * 2 + 1));
    const before = count(db, 'SELECT count(*) AS n FROM observations');
    db.prepare("UPDATE deploy_moves SET done = 0, next_id = '' WHERE version = 3").run();
    await executor().run();
    expect(count(db, 'SELECT count(*) AS n FROM observations')).toBe(before);
  });

  it('the plan counts the recompute as a change of the deploy', () => {
    const { db } = world(2);
    const p = plan(db, V2, deps);
    expect(p.ok && p.diff.some((d) => d.path === 'types.parcel.properties.area.computed')).toBe(true);
  });
});
