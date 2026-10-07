// WP-317 (WP-316 decision 2): one VersionCache per project database, shared by the run store and sync.
import { describe, expect, it } from 'vitest';
import {
  createGeo,
  SYNC_PROTOCOL_VERSION,
  type CompiledConfig,
  type FeatureId,
  type TemplateFile,
} from '@ueberblick/core';
import { openProjectDb } from '../../db/open';
import { deploy } from '../../deploy';
import { configCacheFor, versionCacheFor } from '../../http/shared/config-cache';
import { createProjectServices } from '../../http/shared/services';
import { composeProjectStore } from '../../http/shared/stores';
import { createSyncService } from '../../sync';
import { createVersionCache } from './config-for';
import { createStore } from './index';
import { logSpy } from './log.testkit';
import { anna, build, fid, setup } from './testkit';

const file = {
  schema: 'ueberblick/1',
  template: { key: 'cache', version: '1.0.0' },
  roles: { worker: { label: 'Worker' }, kontrolle: { label: 'Kontrolle' } },
  types: {
    baum: {
      label: 'Baum',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: { note: { type: 'text' } },
    },
  },
  tasks: {
    add: { label: 'Add', who: ['admin', 'kontrolle'], on: '$map', creates: 'baum', form: { note: {} } },
  },
} as unknown as TemplateFile;

describe('one version cache per database', () => {
  it('a version is loaded once across a run and a sync page that share the cache', () => {
    const config = build(file);
    const c = setup({ config, version: 1 });
    const loads: number[] = [];
    const shared = createVersionCache((v: number): CompiledConfig | undefined => {
      loads.push(v);
      return v === 1 ? config : undefined;
    });
    const store = createStore(c.db, { ...c.deps, versions: shared });
    expect(store.submit(c.run('add', anna, { note: 'x' }, fid(1) as FeatureId)).outcome).toBe('accepted');
    const sync = createSyncService(c.db, {
      config: () => ({ version: 1, config }),
      at: () => {
        throw new Error('sync must read through the shared cache');
      },
      versions: shared,
      clock: c.deps.clock,
      geo: createGeo(),
    });
    const page = sync.page(anna, { since: 0, scope: '', v: SYNC_PROTOCOL_VERSION });
    expect(page.features).toHaveLength(1);
    expect(store.submit(c.run('add', anna, { note: 'y' }, fid(2) as FeatureId)).outcome).toBe('accepted');
    expect(loads).toEqual([1]); // compiled once for two runs and a page
  });

  it('the runtime wires the same cache into the store, sync and the resolver readers of a database', () => {
    const db = openProjectDb(':memory:', 'p');
    const clock = { now: () => '2026-10-02T10:00:00Z' };
    expect(deploy(db, file, 'root', { clock }).ok).toBe(true);
    const log = logSpy().log;
    const store = composeProjectStore(db, { clock, log, onOrphanedBlobs: () => undefined });
    const services = createProjectServices({ clock, log, projectDb: () => db, store: () => store });
    expect(versionCacheFor(db)).toBe(versionCacheFor(db));
    expect(versionCacheFor(db).held()).toEqual([]);
    const run = (id: number) =>
      store.submit({
        id: `10000000-0000-7000-8000-${String(id).padStart(12, '0')}` as never,
        task: 'add' as never,
        actor: { id: 'root', kind: 'admin', roles: [] },
        configVersion: 1,
        featureId: fid(id),
        input: { note: 'x' },
      });
    expect(run(1).outcome).toBe('accepted');
    // the store planned through the shared cache ...
    const held = versionCacheFor(db).get(1);
    expect(versionCacheFor(db).held()).toEqual([1]);
    // ... and sync's resolver hands out that very entry (its compiled permissions included), not a second compile
    expect(services.sync('p').versions.at(1)).toBe(held);
    expect(configCacheFor(db).version(1)).toBe(held?.config);
  });
});
