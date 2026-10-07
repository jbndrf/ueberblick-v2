// WP-368 (owner P3): the manual "Auf aktuelle Version verschieben": the plan counts only the Objekte pinned to the old
// version, and the move unpins them and applies the mappings through runs, all or nothing.
import { describe, expect, it } from 'vitest';
import {
  createGeo,
  SYNC_PROTOCOL_VERSION,
  type Actor,
  type FeatureId,
  type Key,
  type RunId,
  type TemplateFile,
} from '@ueberblick/core';
import type { Db } from '../db/driver';
import { openProjectDb } from '../db/open';
import { configCacheFor, versionCacheFor } from '../http/shared/config-cache';
import { composeProjectStore } from '../http/shared/stores';
import { logSpy } from '../store/run/log.testkit';
import { createSyncService } from '../sync';
import { deployProject, type PinDeps } from './index';
import { movePins, pinCounts, planPinMove } from './pin-move';

const clock = { now: () => '2026-10-02T10:00:00Z' };
const OPT = 'types.baum.properties.stage.options.kontrolliert';
const ROOT: Actor = { id: 'root', kind: 'admin', roles: [] };
const perms = { see: '$all', create: '$all', write: '$all' };
const file = (label: string, options: Record<string, string>, withBaum = true): TemplateFile =>
  ({
    schema: 'ueberblick/1',
    template: { key: 'pm', version: '1.0.0' },
    roles: { maker: { label: 'Maker' } },
    types: {
      ...(withBaum
        ? { baum: { label, permissions: perms, properties: { stage: { type: 'select', options } } } }
        : {}),
      strasse: { label: 'Straße', permissions: perms, properties: { name: { type: 'text' } } },
    },
    tasks: {
      ...(withBaum
        ? { anlegen: { label: 'Anlegen', who: ['admin'], on: '$map', creates: 'baum', form: { stage: {} } } }
        : {}),
      anlegen_str: { label: 'Straße', who: ['admin'], on: '$map', creates: 'strasse', form: { name: {} } },
    },
  }) as unknown as TemplateFile;
const V1 = file('Baum', { erfasst: 'Erfasst', kontrolliert: 'Kontrolliert' });
const V2 = file('Baum neu', { erfasst: 'Erfasst' });

/** v1 with `n` running trees; `deployV2` deploys v2 with "belassen", which pins them to v1 (v2 is deployed). */
function world(n: number) {
  const db = openProjectDb(':memory:', 'p');
  const store = composeProjectStore(db, { clock, log: logSpy().log, onOrphanedBlobs: () => undefined });
  let c = 0;
  const mint = (prefix: number) => `${prefix}0000000-0000-7000-8000-${String(++c).padStart(12, '0')}`;
  const pins: PinDeps = { store, ids: { runId: () => mint(2) as RunId } };
  const deps = { clock, afterDeploy: () => undefined, pins };
  expect(deployProject(db, V1, 'root', deps).ok).toBe(true);
  const create = (task: string, input: Record<string, string>): FeatureId => {
    const id = mint(0) as FeatureId;
    const r = store.submit({
      id: mint(1) as RunId,
      task: task as Key,
      actor: ROOT,
      configVersion: 1,
      featureId: id,
      input,
    });
    expect(r.outcome).toBe('accepted');
    return id;
  };
  const trees = Array.from({ length: n }, () => create('anlegen', { stage: 'kontrolliert' }));
  const strasse = create('anlegen_str', { name: 'Hauptstr.' });
  const deployV2 = (): void => {
    const r = deployProject(db, V2, 'root', deps, { [OPT]: { to: 'erfasst' } }, { baum: 'keep' });
    expect(r.ok).toBe(true);
  };
  const state = (id: string) =>
    db
      .prepare<{ pinned_version: number | null; properties: string; lifecycle: string }>(
        'SELECT pinned_version, properties, lifecycle FROM features WHERE id = ?',
      )
      .get(id);
  const stage = (id: string): string =>
    (JSON.parse(state(id)?.properties ?? '{}') as { stage: string }).stage;
  const runCount = (): number => db.prepare<{ n: number }>('SELECT count(*) AS n FROM runs').get()?.n ?? 0;
  return { db, deps, pins, trees, strasse, deployV2, state, stage, runCount };
}

const mapped = { [OPT]: { to: 'erfasst' } } as const;
const pinned = (db: Db): number =>
  db.prepare<{ n: number }>('SELECT count(*) AS n FROM features WHERE pinned_version IS NOT NULL').get()?.n ??
  0;

describe('planPinMove', () => {
  it('lists the breaking differences with counts for exactly the Objekte pinned to that version', () => {
    const w = world(3);
    w.deployV2();
    expect(pinCounts(w.db)).toEqual({ 1: 3 });
    // a floating tree holding the removed value would match the option but is not pinned: it must not count
    w.db.prepare('UPDATE features SET pinned_version = NULL WHERE id = ?').run(w.trees[0] as string);
    const r = planPinMove(w.db, 1);
    if (!r.ok) throw new Error('plan failed');
    expect(r.plan).toMatchObject({ from: 1, to: 2, pinned: 2, types: [{ type: 'baum', count: 2 }] });
    expect(r.plan.diff.find((e) => e.path === OPT)).toMatchObject({ breaking: true, affected: 2 });
  });

  it('refuses a version that cannot be moved: unknown, or the deployed one', () => {
    const w = world(1);
    w.deployV2();
    for (const v of [9, 2]) expect(planPinMove(w.db, v).ok).toBe(false);
  });

  it('a pinned Objekt of a type the deployed version dropped is a problem', () => {
    const w = world(2);
    const dropped = deployProject(
      w.db,
      file('x', {}, false),
      'root',
      w.deps,
      { 'types.baum': { discard: true } },
      { baum: 'keep' },
    );
    expect(dropped.ok).toBe(true);
    const r = planPinMove(w.db, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]?.path).toBe('types.baum');
  });
});

describe('movePins', () => {
  it('unpins through $pin runs and moves the values through $move runs; other types stay', () => {
    const w = world(3);
    w.deployV2();
    const before = w.runCount();
    const r = movePins(w.db, w.pins, 1, mapped);
    expect(r).toMatchObject({ ok: true, from: 1, to: 2, unpinned: 3, moved: 3 });
    expect(pinned(w.db)).toBe(0);
    for (const t of w.trees) expect(w.stage(t)).toBe('erfasst');
    expect(w.state(w.strasse)?.pinned_version).toBeNull();
    // one unpin run and one move run per Objekt: nothing is written directly
    expect(w.runCount() - before).toBe(6);
  });

  it('"Werte verwerfen" unpins without moving the values', () => {
    const w = world(2);
    w.deployV2();
    const r = movePins(w.db, w.pins, 1, { [OPT]: { discard: true } });
    expect(r).toMatchObject({ ok: true, unpinned: 2, moved: 0 });
    expect(pinned(w.db)).toBe(0);
  });

  it('moves completed and archived Objekte along, and unpins deleted ones (P1)', () => {
    const w = world(4);
    const [a, b, c, d] = w.trees as unknown as [string, string, string, string];
    w.deployV2();
    const set = (id: string, l: string) =>
      w.db.prepare('UPDATE features SET lifecycle = ? WHERE id = ?').run(l, id);
    set(b, 'completed');
    set(c, 'archived');
    set(d, 'deleted');
    const r = movePins(w.db, w.pins, 1, mapped);
    expect(r).toMatchObject({ ok: true, unpinned: 4 });
    expect(pinned(w.db)).toBe(0);
    expect([a, b, c].map((id) => w.stage(id))).toEqual(['erfasst', 'erfasst', 'erfasst']);
    expect(w.state(d)?.lifecycle).toBe('deleted');
  });

  it('leaves Objekte pinned to other versions alone', () => {
    const w = world(2);
    w.deployV2();
    const [a] = w.trees as unknown as [string];
    w.db.prepare('UPDATE features SET pinned_version = 7 WHERE id = ?').run(a);
    const r = movePins(w.db, w.pins, 1, mapped);
    expect(r).toMatchObject({ ok: true, unpinned: 1 });
    expect(w.state(a)?.pinned_version).toBe(7);
  });

  it('refuses without a mapping for a breaking change that touches Objekte, and changes nothing', () => {
    const w = world(3);
    w.deployV2();
    const before = w.runCount();
    const r = movePins(w.db, w.pins, 1, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]?.path).toBe(OPT);
    expect(w.runCount()).toBe(before);
    expect(pinned(w.db)).toBe(3);
  });

  it('refuses a mapping to an option that does not exist, and changes nothing', () => {
    const w = world(2);
    w.deployV2();
    const r = movePins(w.db, w.pins, 1, { [OPT]: { to: 'gibt_es_nicht' } });
    expect(r.ok).toBe(false);
    expect(pinned(w.db)).toBe(2);
  });

  it('a run the plan refuses in the middle rolls the whole move back', () => {
    const w = world(4);
    w.deployV2();
    const before = w.runCount();
    let calls = 0;
    const flaky: PinDeps = {
      ids: w.pins.ids,
      store: {
        // the unpin batch goes through, the first move batch is refused
        submitBatch: (runs) =>
          ++calls === 1
            ? w.pins.store.submitBatch(runs)
            : ({ outcome: 'refused', refusal: { code: 'invalid_input' } } as never),
      },
    };
    const r = movePins(w.db, flaky, 1, mapped);
    expect(r.ok).toBe(false);
    expect(pinned(w.db)).toBe(4);
    expect(w.runCount()).toBe(before);
    for (const t of w.trees) expect(w.stage(t)).toBe('kontrolliert');
  });

  it('after the move version 1 has no pins and a second move is refused', () => {
    const w = world(2);
    w.deployV2();
    expect(movePins(w.db, w.pins, 1, mapped).ok).toBe(true);
    expect(pinCounts(w.db)).toEqual({});
    expect(planPinMove(w.db, 1).ok).toBe(false);
  });

  it('version 1 leaves the live set, and a sync page shows the Objekte under the deployed version', () => {
    const w = world(3);
    w.deployV2();
    const sync = createSyncService(w.db, {
      config: () => configCacheFor(w.db).deployed(),
      at: (v) => configCacheFor(w.db).version(v),
      versions: versionCacheFor(w.db),
      clock,
      geo: createGeo(),
    });
    const pull = () =>
      sync.page(
        { id: 'anna', kind: 'participant', roles: ['maker' as Key] },
        { since: 0, scope: '', v: SYNC_PROTOCOL_VERSION },
      );
    expect(pull().header.versions).toEqual({ deployed: 2, live: [1, 2] });
    expect(movePins(w.db, w.pins, 1, mapped).ok).toBe(true);
    const page = pull();
    expect(page.header.versions).toEqual({ deployed: 2, live: [2] });
    const trees = page.features.filter((f) => w.trees.includes(f.id as FeatureId));
    expect(trees).toHaveLength(3);
    expect(new Set(trees.map((f) => f.version))).toEqual(new Set([2]));
  });
});
