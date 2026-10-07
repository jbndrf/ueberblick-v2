// WP-317: the admin deploy and plan endpoints carry the choice per Objektart in `?versions=`.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  composeProjectStore,
  createLogger,
  openProjectDb,
  type Db,
  type PinDeps,
  type Principal,
} from '@ueberblick/server';

const state = vi.hoisted(() => ({ db: undefined as unknown, pins: undefined as unknown }));
vi.mock('../runtime', () => ({
  runtime: () => ({
    projectDb: () => state.db,
    clock: { now: () => '2026-10-02T10:00:00Z' },
    templates: { resolve: () => undefined },
    services: { pins: () => state.pins, afterDeploy: () => undefined },
  }),
}));
vi.mock('../authz', () => ({
  authorizeAdmin: (principal: unknown, projectKey: string) => ({ projectKey, principal }),
}));

const { deployHandler, planHandler } = await import('./admin');

const file = (label: string) => ({
  schema: 'ueberblick/1',
  template: { key: 'adm', version: '1.0.0' },
  roles: { maker: { label: 'Maker' } },
  types: {
    baum: {
      label,
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: { note: { type: 'text' } },
    },
  },
  tasks: { add: { label: 'Add', who: ['admin'], on: '$map', creates: 'baum', form: { note: {} } } },
});

const principal = { kind: 'admin', id: 'a1' } as unknown as Principal;
const call = (query: string, body: unknown) => ({
  params: { project: 'p' },
  locals: { admin: principal },
  getClientAddress: () => '127.0.0.1',
  request: new Request(`http://x/api/admin/p/p/deploy${query}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
});

beforeEach(async () => {
  const db: Db = openProjectDb(':memory:', 'p');
  const clock = { now: () => '2026-10-02T10:00:00Z' };
  const log = createLogger({ sink: () => undefined, now: () => 0 });
  const store = composeProjectStore(db, { clock, log, onOrphanedBlobs: () => undefined });
  let n = 0;
  const pins: PinDeps = {
    store,
    ids: { runId: () => `20000000-0000-7000-8000-${String(++n).padStart(12, '0')}` as never },
  };
  state.db = db;
  state.pins = pins;
  const first = await deployHandler(call('', file('Baum')));
  expect(first.status).toBe(200);
  for (const id of [1, 2]) {
    const r = store.submit({
      id: `10000000-0000-7000-8000-${String(id).padStart(12, '0')}` as never,
      task: 'add' as never,
      actor: { id: 'root', kind: 'admin', roles: [] },
      configVersion: 1,
      featureId: `00000000-0000-7000-8000-${String(id).padStart(12, '0')}` as never,
      input: { note: 'x' },
    });
    expect(r.outcome).toBe('accepted');
  }
});

const pinned = () =>
  (state.db as Db).prepare<{ n: number }>('SELECT count(*) AS n FROM features WHERE pinned_version = 1').get()
    ?.n;

describe('?versions=', () => {
  it('the dry run returns the counts and writes nothing', async () => {
    const res = await planHandler(call('?versions={"baum":"keep"}', file('Baum neu')));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      versions: [{ type: 'baum', running_floating: 2, already_pinned: 0, settled_floating: 0 }],
    });
    expect(pinned()).toBe(0);
  });

  it('no parameter: the default moves, nothing is pinned', async () => {
    const moved = await deployHandler(call('', file('Baum neu')));
    expect(await moved.json()).toMatchObject({ ok: true, pinned: 0 });
    expect(pinned()).toBe(0);
  });

  it('keep writes the pins in the deploy', async () => {
    const res = await deployHandler(call('?versions={"baum":"keep"}', file('Baum neu')));
    expect(await res.json()).toMatchObject({ ok: true, pinned: 2 });
    expect(pinned()).toBe(2);
  });

  it('a choice for an unknown type is a 422 problem; malformed JSON is a 400', async () => {
    const bad = await deployHandler(call('?versions={"gibtsnicht":"keep"}', file('Baum neu')));
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ ok: false, problems: [{ code: 'unknown_path' }] });
    expect((await deployHandler(call('?versions=nope', file('Baum neu')))).status).toBe(400);
    expect((await planHandler(call('?versions=[1]', file('Baum neu')))).status).toBe(400);
    expect(pinned()).toBe(0);
  });
});
