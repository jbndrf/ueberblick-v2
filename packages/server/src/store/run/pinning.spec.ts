// WP-315 (A-029): the server plans and folds each feature under its own version.
import { describe, expect, it } from 'vitest';
import type { CompiledConfig, FeatureId, RecordedObservation, Run, TemplateFile } from '@ueberblick/core';
import { anna, build, fid, headSeq, rid, setup, type Ctx } from './testkit';
import { createVersionCache } from './config-for';
import { NoDeployedVersion } from './contract';
import { createStore } from './index';

const perms = { see: '$all', create: '$all', write: '$all' };
const base = (v: 1 | 2, withBaum: boolean) => ({
  schema: 'ueberblick/1',
  template: { key: 'pin', version: `${v}.0.0` },
  roles: { worker: { label: 'Worker' }, kontrolle: { label: 'Kontrolle' } },
  types: {
    ...(withBaum
      ? {
          baum: {
            label: 'Baum',
            permissions: perms,
            properties: {
              note: { type: 'text' },
              status: { type: 'text' },
              strasse: { type: 'reference', to: 'strasse' },
            },
          },
        }
      : {}),
    strasse: { label: 'Straße', permissions: perms, properties: { name: { type: 'text' } } },
  },
  tasks: {
    ...(withBaum
      ? {
          // reads back through the reference the first step wrote: the overlay must fold the pinned feature (and its
          // edge) under its own schema
          pruefen: {
            label: 'Prüfen',
            on: 'baum',
            form: { strasse: {} },
            then: [{ set: { note: "'geprüft'" } }, { set: { status: 'self.note + self.strasse.name' } }],
          },
          add_baum: { label: 'Baum', on: '$none', creates: 'baum', form: { note: {} } },
        }
      : {}),
    add_strasse: { label: 'Straße', on: '$none', creates: 'strasse', form: { name: {} } },
    ...(v === 2 && withBaum ? { nur_v2: { label: 'Nur v2', on: 'baum' } } : {}),
  },
});

const v1 = build(base(1, true) as unknown as TemplateFile);
const v2 = build(base(2, true) as unknown as TemplateFile);
const v2NoBaum = build(base(2, false) as unknown as TemplateFile);

const BAUM = fid(1);
const FREI = fid(2); // floating
const STR = fid(3);

function world(deployedConfig: CompiledConfig): Ctx {
  const c = setup({ config: v1, version: 1, configs: new Map([[2, deployedConfig]]), deployed: 2 });
  c.seed([{ id: STR, type: 'strasse', properties: { name: ' Hauptstr.' } }]);
  const log: RecordedObservation[] = [];
  let seq = headSeq(c.db);
  for (const [id, pin] of [
    [BAUM, 1],
    [FREI, undefined],
  ] as const) {
    log.push({ featureId: id, property: '$type', result: 'baum', seq: ++seq, runId: rid(900_000) });
    if (pin !== undefined)
      log.push({ featureId: id, property: '$version', result: pin, seq: ++seq, runId: rid(900_000) });
  }
  c.seedObservations(log);
  return c;
}

const device = (c: Ctx, task: string, feature: FeatureId, configVersion = 2): Run =>
  c.run(task, anna, task === 'pruefen' ? { strasse: STR } : {}, feature, { configVersion });
const stamp = (c: Ctx, id: string): number =>
  (
    c.db.prepare<{ config_version: number }>('SELECT config_version FROM runs WHERE id = ?').get(id) as {
      config_version: number;
    }
  ).config_version;

describe('server plan under the feature version', () => {
  it('a run on a feature pinned to v1, with v2 deployed, is planned under v1; a v2-only task is refused', () => {
    const c = world(v2);
    expect(c.store.facts.feature(BAUM)?.pinnedVersion).toBe(1);
    const ok = device(c, 'pruefen', BAUM);
    expect(c.store.submit(ok).outcome).toBe('accepted');
    expect(stamp(c, ok.id)).toBe(1); // restamped under the feature's version (L1)
    expect(c.store.facts.feature(BAUM)?.properties).toMatchObject({
      note: 'geprüft',
      status: 'geprüft Hauptstr.',
    });
    const no = c.store.submit(device(c, 'nur_v2', BAUM));
    expect(no.outcome).toBe('refused');
    // the floating feature of the same type gets the v2 task
    expect(c.store.submit(device(c, 'nur_v2', FREI)).outcome).toBe('accepted');
  });

  it('a floating feature and a create are planned under the deployed version and write no pin', () => {
    const c = world(v2);
    const r = device(c, 'pruefen', FREI, 1); // the device is on v1; the feature floats on v2
    expect(c.store.submit(r).outcome).toBe('accepted');
    expect(stamp(c, r.id)).toBe(2);
    const add = c.run('add_strasse', anna, { name: 'Hauptstr.' }, undefined, { configVersion: 1 });
    const res = c.store.submit(add);
    expect(res.outcome).toBe('accepted');
    expect(stamp(c, add.id)).toBe(2);
    const pins = c.db
      .prepare<{ n: number }>('SELECT count(*) AS n FROM features WHERE pinned_version IS NOT NULL')
      .get();
    expect(pins?.n).toBe(1); // only the seeded one
  });

  it('a pinned feature whose type the deployed config removed still plans, folds and stores under its version', () => {
    const c = world(v2NoBaum);
    expect(c.store.submit(device(c, 'nur_v2', BAUM)).outcome).toBe('refused');
    const r = device(c, 'pruefen', BAUM);
    const res = c.store.submit(r);
    if (res.outcome !== 'accepted') throw new Error(`${res.refusal.code}: ${res.refusal.message}`);
    // the second step read what the first wrote: the overlay folded under v1, where `baum` exists
    expect(c.store.facts.feature(BAUM)?.properties).toMatchObject({
      note: 'geprüft',
      status: 'geprüft Hauptstr.',
    });
    const row = c.db
      .prepare<{ config_version: number; pinned_version: number }>(
        'SELECT config_version, pinned_version FROM features WHERE id = ?',
      )
      .get(BAUM);
    expect(row).toEqual({ config_version: 1, pinned_version: 1 });
    // the floating feature of the removed type has no schema in v2: it cannot be planned any more
    expect(c.store.submit(device(c, 'pruefen', FREI)).outcome).toBe('refused');
  });

  it('a `$version` observation pins and unpins through the projection (system run)', () => {
    const c = world(v2);
    c.seedObservations([
      { featureId: FREI, property: '$version', result: 1, seq: headSeq(c.db) + 1, runId: rid(900_001) },
    ]);
    expect(c.store.facts.feature(FREI)?.pinnedVersion).toBe(1);
    c.seedObservations([
      { featureId: FREI, property: '$version', result: null, seq: headSeq(c.db) + 1, runId: rid(900_002) },
    ]);
    expect(c.store.facts.feature(FREI)?.pinnedVersion).toBeUndefined();
  });

  it('with the deployed row missing, the run is refused with a typed error, not defaulted', () => {
    const c = setup({ config: v1, version: 1 });
    c.db.prepare('DELETE FROM config_versions').run();
    c.seed([
      { id: STR, type: 'strasse', properties: { name: ' Hauptstr.' } },
      { id: BAUM, type: 'baum', properties: {} },
    ]);
    const r = c.run('pruefen', anna, { strasse: STR }, BAUM);
    expect(() => c.store.submit(r)).toThrow(NoDeployedVersion);
  });
});

describe('the config cache', () => {
  const load = (log: number[]) => (n: number) => {
    log.push(n);
    return n < 10 ? (n % 2 === 0 ? v2 : v1) : undefined;
  };

  it('compiles a version once while it stays in the cache; evicts the least recently used', () => {
    const log: number[] = [];
    const cache = createVersionCache(load(log), 2);
    const a = cache.get(1);
    expect(cache.get(1)).toBe(a); // a hit: the same entry (config and perms), nothing loaded
    cache.get(2);
    cache.get(1); // 1 is now the most recent
    cache.get(3); // evicts 2
    expect(cache.held()).toEqual([1, 3]);
    expect(log).toEqual([1, 2, 3]);
    cache.get(2); // a miss again
    expect(log).toEqual([1, 2, 3, 2]);
  });

  it('a gone version is undefined and not cached', () => {
    const cache = createVersionCache(load([]), 2);
    expect(cache.get(99)).toBeUndefined();
    expect(cache.held()).toEqual([]);
  });

  it('holds at least one version', () => {
    expect(() => createVersionCache(load([]), 0)).toThrow();
  });

  it('the store loads each version once across runs (cache size 1 forces reloads, 8 does not)', () => {
    const loads: number[] = [];
    const c = world(v2);
    const load = (n: number) => {
      loads.push(n);
      return c.deps.config(n);
    };
    const counting = createStore(c.db, { ...c.deps, config: load, versions: createVersionCache(load) });
    for (let i = 0; i < 3; i++) {
      counting.submit(device(c, 'pruefen', BAUM));
      counting.submit(device(c, 'pruefen', FREI));
    }
    expect(loads.sort()).toEqual([1, 2]); // one compile per version, six runs
  });
});
