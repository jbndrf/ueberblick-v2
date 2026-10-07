// WP-317 (A-029 item 5): the deploy choice "belassen / verschieben" per Objektart writes pins; value moves skip pinned features.
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
import { deployProject, plan, type PinDeps, type VersionChoices } from './index';
import { createMoveExecutor } from './move-executor';
import { featuresToMove } from './move-select';
import { PIN_BATCH_SIZE } from './pins';

const clock = { now: () => '2026-10-02T10:00:00Z' };
const OPT = 'types.baum.properties.stage.options.kontrolliert';
const ROOT: Actor = { id: 'root', kind: 'admin', roles: [] };

const perms = { see: '$all', create: '$all', write: '$all' };
const file = (label: string, options: Record<string, string>): TemplateFile =>
  ({
    schema: 'ueberblick/1',
    template: { key: 'pins', version: '1.0.0' },
    roles: { maker: { label: 'Maker' } },
    types: {
      baum: {
        label,
        permissions: perms,
        properties: { stage: { type: 'select', options } },
      },
      strasse: { label: 'Straße', permissions: perms, properties: { name: { type: 'text' } } },
      leer: { label: 'Leer', permissions: perms, properties: { name: { type: 'text' } } },
    },
    tasks: {
      anlegen: { label: 'Anlegen', who: ['admin'], on: '$map', creates: 'baum', form: { stage: {} } },
      anlegen_str: { label: 'Straße', who: ['admin'], on: '$map', creates: 'strasse', form: { name: {} } },
    },
  }) as unknown as TemplateFile;

const OPTIONS = { erfasst: 'Erfasst', kontrolliert: 'Kontrolliert' };
const V1 = file('Baum', OPTIONS);
const V2 = file('Baum neu', { erfasst: 'Erfasst' }); // baum changed (label, option removed); strasse and leer unchanged

const num = (db: Db, sql: string, ...p: string[]): number => db.prepare<{ n: number }>(sql).get(...p)?.n ?? 0;

/** A project at v1 with running `baum` and `strasse` features, ready for a second deploy. */
function world(baeume: number) {
  const db = openProjectDb(':memory:', 'p');
  const store = composeProjectStore(db, { clock, log: logSpy().log, onOrphanedBlobs: () => undefined });
  let n = 0;
  const mint = (prefix: number) => `${prefix}0000000-0000-7000-8000-${String(++n).padStart(12, '0')}`;
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
  const trees = Array.from({ length: baeume }, () => create('anlegen', { stage: 'kontrolliert' }));
  const strasse = create('anlegen_str', { name: 'Hauptstr.' });
  const setLifecycle = (id: string, lifecycle: string) =>
    db.prepare('UPDATE features SET lifecycle = ? WHERE id = ?').run(lifecycle, id);
  const pinnedOf = (id: string): number | null =>
    db.prepare<{ pinned_version: number | null }>('SELECT pinned_version FROM features WHERE id = ?').get(id)
      ?.pinned_version ?? null;
  return { db, store, deps, trees, strasse, setLifecycle, pinnedOf, ids: pins.ids };
}

const relabel = (f: TemplateFile, section: 'types' | 'tasks', key: string, label: string): void => {
  const entry = (f[section] as Record<string, { label: string }> | undefined)?.[key];
  if (entry === undefined) throw new Error(`${section}.${key} is missing`);
  entry.label = label;
};
const stageOf = (db: Db, id: string): string => {
  const row = db.prepare<{ properties: string }>('SELECT properties FROM features WHERE id = ?').get(id);
  if (row === undefined) throw new Error(`no feature ${id}`);
  return (JSON.parse(row.properties) as { stage: string }).stage;
};

const keepBaum: VersionChoices = { baum: 'keep' };

describe('the dry run counts', () => {
  it('returns the three counts for a changed type with running features, nothing for unchanged types or a first deploy', () => {
    const w = world(5);
    const [a, b, c, d] = w.trees as unknown as [string, string, string, string];
    w.setLifecycle(b, 'completed');
    w.setLifecycle(c, 'archived');
    w.db.prepare('UPDATE features SET pinned_version = 1 WHERE id = ?').run(d);
    const r = plan(w.db, V2, w.deps);
    if (!r.ok) throw new Error('plan failed');
    // a and the fifth tree are running floating; b completed and c archived are settled; d is pinned
    expect(r.versions).toEqual([
      { type: 'baum', running_floating: 2, already_pinned: 1, settled_floating: 2 },
    ]);
    expect(a).toBeDefined();
    // the first deploy has no features and no deployed version to keep
    const fresh = openProjectDb(':memory:', 'fresh');
    const first = plan(fresh, V1, w.deps);
    expect(first.ok && first.versions).toEqual([]);
  });

  it('a task or rule change counts for the type it belongs to', () => {
    const w = world(2);
    const tasks = structuredClone(V1);
    relabel(tasks, 'tasks', 'anlegen', 'Neu anlegen');
    const r = plan(w.db, tasks, w.deps);
    expect(r.ok && r.versions.map((v) => v.type)).toEqual(['baum']);
  });

  it('the same file as the deployed one has no counts', () => {
    const w = world(2);
    const r = plan(w.db, V1, w.deps);
    expect(r.ok && r.versions).toEqual([]);
  });
});

describe('keep', () => {
  it('pins every running floating feature to the previous version with one system run each, in the deploy transaction', () => {
    const w = world(4);
    const [a, b, c] = w.trees as unknown as [string, string, string];
    w.setLifecycle(b, 'completed');
    w.setLifecycle(c, 'archived');
    const r = deployProject(w.db, V2, 'root', w.deps, {}, keepBaum);
    expect(r.ok && r.pinned).toBe(2);
    expect(w.pinnedOf(a)).toBe(1);
    expect(w.pinnedOf(w.trees[3] as string)).toBe(1);
    expect(w.pinnedOf(b)).toBeNull(); // completed and archived are settled: they move
    expect(w.pinnedOf(c)).toBeNull();
    expect(w.pinnedOf(w.strasse)).toBeNull(); // another type
    expect(num(w.db, "SELECT count(*) AS n FROM runs WHERE task = '$pin'")).toBe(2);
    const row = w.db
      .prepare<{ actor_kind: string; config_version: number }>(
        "SELECT actor_kind, config_version FROM runs WHERE task = '$pin' LIMIT 1",
      )
      .get();
    expect(row).toEqual({ actor_kind: 'system', config_version: 1 });
    expect(num(w.db, "SELECT version AS n FROM config_versions WHERE status = 'deployed'")).toBe(2);
  });

  it('sync then lists both versions as live', () => {
    const w = world(3);
    expect(deployProject(w.db, V2, 'root', w.deps, {}, keepBaum).ok).toBe(true);
    const sync = createSyncService(w.db, {
      config: () => configCacheFor(w.db).deployed(),
      at: (v) => configCacheFor(w.db).version(v),
      versions: versionCacheFor(w.db),
      clock,
      geo: createGeo(),
    });
    const page = sync.page(
      { id: 'anna', kind: 'participant', roles: ['maker' as Key] },
      { since: 0, scope: '', v: SYNC_PROTOCOL_VERSION },
    );
    expect(page.header.versions).toEqual({ deployed: 2, live: [1, 2] });
  });

  it('does not touch a feature that is already pinned, and pins in batches over a large type', () => {
    const w = world(PIN_BATCH_SIZE + 3);
    w.db.prepare('UPDATE features SET pinned_version = 1 WHERE id = ?').run(w.trees[0] as string);
    const r = deployProject(w.db, V2, 'root', w.deps, {}, keepBaum);
    expect(r.ok && r.pinned).toBe(PIN_BATCH_SIZE + 2);
    expect(num(w.db, 'SELECT count(*) AS n FROM features WHERE pinned_version = 1')).toBe(PIN_BATCH_SIZE + 3);
    expect(num(w.db, "SELECT count(*) AS n FROM runs WHERE task = '$pin'")).toBe(PIN_BATCH_SIZE + 2);
  });

  it('a blocked deploy (bad mapping) writes no pin', () => {
    const w = world(2);
    const r = deployProject(w.db, V2, 'root', w.deps, { [OPT]: { to: 'gibtsnicht' } }, keepBaum);
    expect(r.ok).toBe(false);
    expect(num(w.db, 'SELECT count(*) AS n FROM features WHERE pinned_version IS NOT NULL')).toBe(0);
    expect(num(w.db, "SELECT count(*) AS n FROM runs WHERE task = '$pin'")).toBe(0);
  });

  it('without a pin writer a keep throws instead of silently moving', () => {
    const w = world(1);
    expect(() =>
      deployProject(w.db, V2, 'root', { clock, afterDeploy: () => undefined }, {}, keepBaum),
    ).toThrow(/pins/);
    expect(num(w.db, "SELECT version AS n FROM config_versions WHERE status = 'deployed'")).toBe(1);
  });
});

describe('move and the default', () => {
  it('writes no pins, with or without the explicit choice', () => {
    for (const choices of [undefined, { baum: 'move' } as VersionChoices]) {
      const w = world(3);
      const r = deployProject(w.db, V2, 'root', w.deps, {}, choices);
      expect(r.ok && r.pinned).toBe(0);
      expect(num(w.db, 'SELECT count(*) AS n FROM features WHERE pinned_version IS NOT NULL')).toBe(0);
      expect(num(w.db, "SELECT count(*) AS n FROM runs WHERE task = '$pin'")).toBe(0);
    }
  });
});

describe('value moves skip pinned features', () => {
  it('the plan count and the executor selection leave pinned features out', async () => {
    const w = world(3);
    const [pinned, ...floating] = w.trees as unknown as [string, string, string];
    w.db.prepare('UPDATE features SET pinned_version = 1 WHERE id = ?').run(pinned);
    const r = plan(w.db, V2, w.deps);
    const entry = r.ok ? r.diff.find((e) => e.path === OPT) : undefined;
    expect(entry?.affected).toBe(2);
    const move = { type: 'baum', property: 'stage', from: 'kontrolliert', to: 'erfasst' };
    expect(featuresToMove(w.db, move, '', 10).sort()).toEqual([...floating].sort());

    const dep = deployProject(w.db, V2, 'root', w.deps, { [OPT]: { to: 'erfasst' } });
    expect(dep.ok && dep.moves).toBe(1);
    let n = 9000;
    await createMoveExecutor(w.db, {
      store: w.store,
      ids: { runId: () => `30000000-0000-7000-8000-${String(++n).padStart(12, '0')}` as RunId },
      pause: () => Promise.resolve(),
    }).run();
    const stage = (id: string): string => stageOf(w.db, id);
    expect(stage(pinned)).toBe('kontrolliert');
    expect(floating.map(stage)).toEqual(['erfasst', 'erfasst']);
  });

  it('keep plus a mapping: the kept features keep their old option, the settled ones move', async () => {
    const w = world(3);
    const [a, b] = w.trees as unknown as [string, string, string];
    w.setLifecycle(b, 'completed');
    const dep = deployProject(w.db, V2, 'root', w.deps, { [OPT]: { to: 'erfasst' } }, keepBaum);
    expect(dep.ok && dep.pinned).toBe(2);
    let n = 9000;
    await createMoveExecutor(w.db, {
      store: w.store,
      ids: { runId: () => `30000000-0000-7000-8000-${String(++n).padStart(12, '0')}` as RunId },
      pause: () => Promise.resolve(),
    }).run();
    const stage = (id: string): string => stageOf(w.db, id);
    expect(stage(a)).toBe('kontrolliert');
    expect(stage(b)).toBe('erfasst');
  });
});

describe('refused choices', () => {
  it.each([
    ['an unknown type', { gibtsnicht: 'keep' }, 'versions.gibtsnicht'],
    ['an unchanged type', { strasse: 'keep' }, 'versions.strasse'],
    ['a type with no running features', { leer: 'keep' }, 'versions.leer'],
  ] as const)(
    '%s is a typed problem, in the dry run and in the deploy, and nothing is written',
    (_n, choices, path) => {
      const w = world(2);
      const noop = structuredClone(V2);
      relabel(noop, 'types', 'leer', 'Leer neu'); // changed, but nothing runs
      const p = plan(w.db, noop, w.deps, choices as VersionChoices);
      expect(!p.ok && p.problems[0]).toMatchObject({ code: 'unknown_path', path });
      const d = deployProject(w.db, noop, 'root', w.deps, {}, choices as VersionChoices);
      expect(!d.ok && d.problems[0]).toMatchObject({ code: 'unknown_path', path });
      expect(num(w.db, "SELECT version AS n FROM config_versions WHERE status = 'deployed'")).toBe(1);
      expect(num(w.db, 'SELECT count(*) AS n FROM features WHERE pinned_version IS NOT NULL')).toBe(0);
    },
  );

  it('an unknown choice value is refused', () => {
    const w = world(2);
    const p = plan(w.db, V2, w.deps, { baum: 'maybe' } as unknown as VersionChoices);
    expect(!p.ok && p.problems[0]).toMatchObject({ code: 'schema_invalid', path: 'versions.baum' });
  });

  it('a choice for the file that is already deployed is refused (nothing changed)', () => {
    const w = world(2);
    const d = deployProject(w.db, V1, 'root', w.deps, {}, keepBaum);
    expect(d.ok).toBe(false);
  });
});

describe('first deploy', () => {
  it('has no choice, no pins and reports none', () => {
    const db = openProjectDb(':memory:', 'p');
    const r = deployProject(db, V1, 'root', { clock, afterDeploy: () => undefined });
    expect(r.ok && r.pinned).toBe(0);
    const choice = deployProject(
      openProjectDb(':memory:', 'q'),
      V1,
      'root',
      { clock, afterDeploy: () => undefined },
      {},
      keepBaum,
    );
    expect(!choice.ok && choice.problems[0]?.code).toBe('unknown_path');
  });
});
