import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { Actor, FeatureId, Key, RunId, TemplateFile } from '@ueberblick/core';
import { createLogger } from '../../log';
import { fileBlobStore } from '../../blobs';
import { openProjectDb } from '../../db/open';
import type { Db } from '../../db/driver';
import { deploy } from '../../deploy';
import type { DoorbellMessage } from '../../sync';
import { startTimersLoop } from '../../timers';
import type { TransactionHook } from '../../store';
import { createProjectServices } from './services';
import { projectStoresFor } from './stores';
import { embedGoldenRefs } from '@ueberblick/core/testing';
import { withAuto } from '../../store/run/testkit';

const template = embedGoldenRefs(
  parse(
    readFileSync(
      fileURLToPath(
        new URL('../../../../../fixtures/golden/templates/baumkataster/1.0.0.yaml', import.meta.url),
      ),
      'utf8',
    ),
  ),
) as TemplateFile;
const withoutElapsed: TemplateFile = withAuto(template, [], [['system_faellig', 'kontrolle_wird_faellig']]);

const anna: Actor = { id: 'anna', kind: 'participant', roles: ['kontrolle' as Key] };
let n = 0;
const rid = (): RunId => `00000000-0000-7000-8000-${String(++n).padStart(12, '0')}` as RunId;

/** A runtime in miniature: the deps `projectStoresFor` reads, over in-memory project databases. */
function world(extra: TransactionHook[] = [], onHooks: () => void = () => undefined) {
  const clock = { at: '2026-03-01T08:00:00.000Z' };
  const dbs = new Map<string, Db>();
  const opened: string[] = [];
  const projectDb = (key: string): Db => {
    let db = dbs.get(key);
    if (!db) {
      db = openProjectDb(':memory:', key);
      dbs.set(key, db);
      opened.push(key);
    }
    return db;
  };
  const clockPort = { now: () => clock.at };
  const rt: Parameters<typeof projectStoresFor>[0] = {
    clock: clockPort,
    log: createLogger({ sink: () => undefined, now: () => 0 }),
    projectDb,
    blobs: {
      store: () => fileBlobStore(mkdtempSync(join(tmpdir(), 'ub-services-'))),
      onError: () => undefined,
    },
    hooks: (p) => {
      onHooks();
      return [...services.hooks(p), ...extra];
    },
    doorbell: (key) => services.doorbell(key),
  };
  const services = createProjectServices({
    log: createLogger({ sink: () => undefined, now: () => 0 }),
    clock: clockPort,
    projectDb,
    store: (k) => projectStoresFor(rt)(k),
  });
  const stores = projectStoresFor(rt);
  return { clock, projectDb, opened, rt, services, stores };
}

const newTree = (id?: string) => ({
  id: rid(),
  task: 'erfassen' as Key,
  actor: anna,
  configVersion: 1,
  input: { geometrie: { type: 'Point', coordinates: [7.1, 50.7] }, vitalitaet: 'v2' },
  ...(id === undefined ? {} : { featureId: id as FeatureId }),
});

const timerRows = (db: Db): number =>
  (db.prepare<{ n: number }>('SELECT count(*) n FROM timers').get() as { n: number }).n;

describe('projectStoresFor: one Store per project', () => {
  it('memoises on the runtime and per project, and attaches the hooks once per project', () => {
    let attached = 0;
    const w = world([], () => void attached++);
    const a1 = w.stores('a');
    expect(projectStoresFor(w.rt)('a')).toBe(a1);
    expect(w.stores('a')).toBe(a1);
    expect(w.stores('b')).not.toBe(a1);
    expect(attached).toBe(2); // once per project, however often the store is asked for
  });

  it('the hooks of a project run once per run, inside the run transaction', () => {
    let seen = 0;
    const w = world([() => void seen++]);
    deploy(w.projectDb('a'), template, 'admin', { clock: w.rt.clock });
    expect(w.stores('a').submit(newTree()).outcome).toBe('accepted');
    expect(seen).toBe(1);
    expect(timerRows(w.projectDb('a'))).toBe(1); // the timers hook is one of them
  });
});

describe('the doorbell rings for runs of the shared store', () => {
  it('a submitted run rings its project only, at once', () => {
    const w = world();
    deploy(w.projectDb('a'), template, 'admin', { clock: w.rt.clock });
    deploy(w.projectDb('b'), template, 'admin', { clock: w.rt.clock });
    const heard: string[] = [];
    const listen = (key: string) =>
      w.services.doorbell(key).subscribe((m: DoorbellMessage) => heard.push(`${key} ${m.from}-${m.to}`));
    const offs = [listen('a'), listen('b')];
    w.stores('a').submit(newTree());
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatch(/^a 1-\d+$/);
    offs.forEach((off) => off());
  });

  it('a refused run does not ring', () => {
    const w = world();
    deploy(w.projectDb('a'), template, 'admin', { clock: w.rt.clock });
    const heard: unknown[] = [];
    const off = w.services.doorbell('a').subscribe((m) => heard.push(m));
    const refused = w.stores('a').submit({ ...newTree(), input: { vitalitaet: 'v2' } });
    expect(refused.outcome).toBe('refused');
    expect(heard).toEqual([]);
    off();
  });
});

describe('elapsed rules fire through the timers loop', () => {
  it('a due row becomes a system run through the shared store; it rings the bell and shows in sync', () => {
    const w = world();
    const db = w.projectDb('a');
    deploy(db, template, 'admin', { clock: w.rt.clock });
    w.stores('a').submit(newTree());
    const heard: DoorbellMessage[] = [];
    const off = w.services.doorbell('a').subscribe((m) => heard.push(m));
    const sync = w.services.sync('a');
    const head = sync.head();

    let beat: (() => void) | undefined;
    const loop = startTimersLoop({
      clock: w.rt.clock,
      projects: () => ['a'],
      timers: (k) => w.services.timers(k),
      intervalMs: 30_000,
      every: (fn) => {
        beat = fn;
        return () => undefined;
      },
    });
    expect(heard).toEqual([]); // not due yet: the tree is checked again in a year

    w.clock.at = '2029-01-01T00:00:00.000Z';
    beat?.();
    expect(heard).toHaveLength(1);
    expect(heard[0]?.from).toBe(head + 1);
    const page = sync.page(
      { id: 'anna', kind: 'participant', roles: ['kontrolle' as Key] },
      {
        since: head,
        scope: '',
        v: 1,
      },
    );
    expect(page.features).toHaveLength(1);
    expect(page.features[0]?.properties['kontrolle_faellig']).toBe(true);
    expect(timerRows(db)).toBe(0); // consumed, and the rule's own effect does not schedule it again
    off();
    loop.stop();
  });
});

describe('afterDeploy', () => {
  it('rebuilds the schedules, so a rule added by the deploy covers the features that already exist', () => {
    const w = world();
    const db = w.projectDb('a');
    deploy(db, withoutElapsed, 'admin', { clock: w.rt.clock });
    w.stores('a').submit(newTree());
    expect(timerRows(db)).toBe(0);
    const r = deploy(db, template, 'admin', { clock: w.rt.clock });
    expect(r.ok && r.version).toBe(2);
    w.services.afterDeploy('a');
    expect(timerRows(db)).toBe(1);
  });

  it('and drops the rows of a rule the new version no longer has', () => {
    const w = world();
    const db = w.projectDb('a');
    deploy(db, template, 'admin', { clock: w.rt.clock });
    w.stores('a').submit(newTree());
    expect(timerRows(db)).toBe(1);
    deploy(db, withoutElapsed, 'admin', { clock: w.rt.clock });
    w.services.afterDeploy('a');
    expect(timerRows(db)).toBe(0);
  });
});

describe('the deployed config is loaded once per version', () => {
  it('sync, timers and the run store share one compiled config', () => {
    const w = world();
    const db = w.projectDb('a');
    deploy(db, template, 'admin', { clock: w.rt.clock });
    const a = w.services.deployed('a');
    expect(a?.version).toBe(1);
    expect(w.services.deployed('a')?.config).toBe(a?.config);
    deploy(db, withoutElapsed, 'admin', { clock: w.rt.clock });
    expect(w.services.deployed('a')?.version).toBe(2);
    expect(w.services.deployed('empty')).toBeUndefined();
  });
});
