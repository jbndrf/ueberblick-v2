// WP-355: a deploy rings the sync doorbell once, after its commit; the pin runs inside the deploy transaction never ring.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Actor, FeatureId, Key, RunId, TemplateFile } from '@ueberblick/core';
import { fileBlobStore } from '../../blobs';
import { openProjectDb } from '../../db/open';
import type { Db } from '../../db/driver';
import { deployProject, type PinDeps, type VersionChoices } from '../../deploy';
import { createLogger } from '../../log';
import type { Doorbell, DoorbellOptions } from '../../sync';
import { createProjectServices } from './services';
import { projectStoresFor } from './stores';

/** Every ring that reached the real bell, with the transaction depth at that moment. */
const state = vi.hoisted(() => ({ depth: 0, rings: [] as { readonly depth: number }[] }));

vi.mock('../../sync', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    createDoorbell: (opts: DoorbellOptions): Doorbell => {
      const bell = (real.createDoorbell as (o: DoorbellOptions) => Doorbell)(opts);
      return {
        ring: () => {
          state.rings.push({ depth: state.depth });
          bell.ring();
        },
        subscribe: (l) => bell.subscribe(l),
        head: () => bell.head(),
        get listeners() {
          return bell.listeners;
        },
      };
    },
  };
});

const clock = { now: () => '2026-10-02T10:00:00Z' };
const ROOT: Actor = { id: 'root', kind: 'admin', roles: [] };
const perms = { see: '$all', create: '$all', write: '$all' };
const file = (label: string, options: Record<string, string>): TemplateFile =>
  ({
    schema: 'ueberblick/1',
    template: { key: 'bell', version: '1.0.0' },
    roles: { maker: { label: 'Maker' } },
    types: { baum: { label, permissions: perms, properties: { stage: { type: 'select', options } } } },
    tasks: {
      anlegen: { label: 'Anlegen', who: ['admin'], on: '$map', creates: 'baum', form: { stage: {} } },
    },
  }) as unknown as TemplateFile;
const V1 = file('Baum', { erfasst: 'Erfasst', kontrolliert: 'Kontrolliert' });
const V2 = file('Baum neu', { erfasst: 'Erfasst' });

let n = 0;
const mint = (p: number) => `${p}0000000-0000-7000-8000-${String(++n).padStart(12, '0')}`;

function world() {
  const raw = openProjectDb(':memory:', 'p');
  // Counts the open transactions: a ring while it is above zero is a ring inside the deploy transaction.
  const db: Db = {
    ...raw,
    transaction: (fn) => {
      state.depth++;
      try {
        return raw.transaction(fn);
      } finally {
        state.depth--;
      }
    },
  };
  const log = createLogger({ sink: () => undefined, now: () => 0 });
  const rt: Parameters<typeof projectStoresFor>[0] = {
    clock,
    log,
    projectDb: () => db,
    blobs: { store: () => fileBlobStore(mkdtempSync(join(tmpdir(), 'ub-bell-'))), onError: () => undefined },
    hooks: (p) => services.hooks(p),
    doorbell: (key) => services.doorbell(key),
  };
  const services = createProjectServices({
    log,
    clock,
    projectDb: () => db,
    store: (k) => projectStoresFor(rt)(k),
    doorbellPollMs: 0,
  });
  const deployWith = (f: TemplateFile, choices?: VersionChoices, pins: PinDeps = services.pins('p')) =>
    deployProject(
      db,
      f,
      'root',
      { clock, afterDeploy: () => services.afterDeploy('p'), pins },
      undefined,
      choices,
    );
  expect(deployWith(V1).ok).toBe(true);
  const create = (): void => {
    const r = projectStoresFor(rt)('p').submit({
      id: mint(1) as RunId,
      task: 'anlegen' as Key,
      actor: ROOT,
      configVersion: 1,
      featureId: mint(0) as FeatureId,
      input: { stage: 'kontrolliert' },
    });
    expect(r.outcome).toBe('accepted');
  };
  create();
  const messages: unknown[] = [];
  services.doorbell('p').subscribe((m) => messages.push(m));
  state.rings.length = 0;
  return { services, deployWith, create, messages };
}

describe('deploy and the doorbell', () => {
  it('a keep deploy rings exactly once, after the commit, never inside the transaction', () => {
    const w = world();
    const r = w.deployWith(V2, { baum: 'keep' });
    expect(r).toMatchObject({ ok: true, pinned: 1 });
    expect(state.rings).toEqual([{ depth: 0 }]);
    expect(w.messages).toHaveLength(1);
  });

  it('a move deploy rings once after the commit', () => {
    const w = world();
    expect(w.deployWith(V2, { baum: 'move' })).toMatchObject({ ok: true, created: true });
    expect(state.rings).toEqual([{ depth: 0 }]);
  });

  it('a deploy that throws inside the transaction rings nothing; the next run rings normally', () => {
    const w = world();
    const real = w.services.pins('p');
    const failing: PinDeps = {
      ...real,
      store: {
        submitBatch: (runs) => {
          real.store.submitBatch(runs); // the pins are written, then the deploy fails
          throw new Error('boom');
        },
      },
    };
    expect(() => w.deployWith(V2, { baum: 'keep' }, failing)).toThrow('boom');
    expect(state.rings).toEqual([]);
    expect(w.messages).toHaveLength(0);
    w.create();
    expect(state.rings).toEqual([{ depth: 0 }]);
    expect(w.messages).toHaveLength(1);
  });
});
