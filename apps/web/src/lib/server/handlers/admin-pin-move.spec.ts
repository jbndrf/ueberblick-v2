// WP-368 (owner P3): the admin endpoints of "Auf aktuelle Version verschieben": the dry run as the deploy overview's shapes,
// and the move through runs, all or nothing, with the doorbell once after it commits.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  composeProjectStore,
  createLogger,
  deployProject,
  openProjectDb,
  type Db,
  type PinDeps,
  type Principal,
} from '@ueberblick/server';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  pins: undefined as unknown,
  afterDeploy: vi.fn(),
}));
vi.mock('../runtime', () => ({
  runtime: () => ({
    projectDb: () => state.db,
    clock: { now: () => '2026-10-02T10:00:00Z' },
    templates: { resolve: () => undefined },
    services: { pins: () => state.pins, afterDeploy: state.afterDeploy },
  }),
}));
vi.mock('../authz', () => ({
  authorizeAdmin: (principal: unknown, projectKey: string) => ({ projectKey, principal }),
}));

const { deployHandler, pinMoveHandler, pinMovePlanHandler } = await import('./admin');
// The route passes the builder's `buildPlan` requirements; `lib/` never imports the builder, so the spec states them.
const requirementsOf = () => [{ path: OPT, choices: ['erfasst'] }];

const OPT = 'types.baum.properties.stage.options.kontrolliert';
const file = (label: string, options: Record<string, string>) => ({
  schema: 'ueberblick/1',
  template: { key: 'adm', version: '1.0.0' },
  roles: { maker: { label: 'Maker' } },
  types: {
    baum: {
      label,
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: { stage: { type: 'select', options } },
    },
  },
  tasks: { add: { label: 'Add', who: ['admin'], on: '$map', creates: 'baum', form: { stage: {} } } },
});

const principal = { kind: 'admin', id: 'a1' } as unknown as Principal;
const params = { project: 'p' };
const locals = { admin: principal };
const post = (path: string, body: unknown, query = '') => ({
  params,
  locals,
  getClientAddress: () => '127.0.0.1',
  request: new Request(`http://x/${path}${query}`, { method: 'POST', body: JSON.stringify(body) }),
});
const get = (query: string) => ({
  params,
  locals,
  getClientAddress: () => '127.0.0.1',
  request: new Request(`http://x/move${query}`),
});

const pinned = (): number =>
  (state.db as Db).prepare<{ n: number }>('SELECT count(*) AS n FROM features WHERE pinned_version = 1').get()
    ?.n ?? 0;
const stages = (): string[] =>
  (state.db as Db)
    .prepare<{ properties: string }>('SELECT properties FROM features ORDER BY id')
    .all()
    .map((r) => (JSON.parse(r.properties) as { stage: string }).stage);

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
  const v1 = file('Baum', { erfasst: 'Erfasst', kontrolliert: 'Kontrolliert' });
  expect((await deployHandler(post('deploy', v1))).status).toBe(200);
  for (const id of [1, 2, 3]) {
    const r = store.submit({
      id: `10000000-0000-7000-8000-${String(id).padStart(12, '0')}` as never,
      task: 'add' as never,
      actor: { id: 'root', kind: 'admin', roles: [] },
      configVersion: 1,
      featureId: `00000000-0000-7000-8000-${String(id).padStart(12, '0')}` as never,
      input: { stage: 'kontrolliert' },
    });
    expect(r.outcome).toBe('accepted');
  }
  // v2 drops the Phase "kontrolliert" (its Objekte move to "erfasst") and keeps the running Objekte on v1: it pins them.
  const mapped = deployProject(
    db,
    file('Baum', { erfasst: 'Erfasst' }) as never,
    'a1',
    { clock, templates: { resolve: () => undefined }, pins, afterDeploy: () => undefined },
    { [OPT]: { to: 'erfasst' } },
    { baum: 'keep' },
  );
  expect(mapped.ok).toBe(true);
  expect(pinned()).toBe(3);
  state.afterDeploy.mockClear(); // the deploys above rang it; only the move counts
});

describe('GET the dry run', () => {
  it('lists the breaking difference with the count of the pinned Objekte, in the overview shapes', async () => {
    const res = await pinMovePlanHandler(get('?version=1&locale=de'), requirementsOf);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      view: {
        from: number;
        to: number;
        pinned: number;
        types: { type: string; label: string; count: number }[];
        plan: {
          groups: { type: string; entries: { affected?: number }[] }[];
          mappings: { path: string; affected: number; choices: { key: string }[] }[];
        };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.view).toMatchObject({
      from: 1,
      to: 2,
      pinned: 3,
      types: [{ type: 'baum', label: 'Baum', count: 3 }],
    });
    expect(body.view.plan.groups[0]?.entries.map((e) => e.affected)).toEqual([3]);
    expect(body.view.plan.mappings).toMatchObject([
      { path: OPT, affected: 3, choices: [{ key: 'erfasst' }] },
    ]);
    expect(pinned()).toBe(3);
  });

  it('refuses a version with nothing pinned, a bad version, and the deployed one', async () => {
    expect((await pinMovePlanHandler(get('?version=2'), requirementsOf)).status).toBe(422);
    expect((await pinMovePlanHandler(get('?version=abc'), requirementsOf)).status).toBe(400);
    expect((await pinMovePlanHandler(get(''), requirementsOf)).status).toBe(400);
    expect((await pinMovePlanHandler(get('?version=9'), requirementsOf)).status).toBe(422);
  });
});

describe('POST the move', () => {
  it('unpins and moves through runs, then rings the doorbell once', async () => {
    const res = await pinMoveHandler(post('move', { version: 1, mappings: { [OPT]: { to: 'erfasst' } } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, from: 1, to: 2, unpinned: 3, moved: 3 });
    expect(pinned()).toBe(0);
    expect(stages()).toEqual(['erfasst', 'erfasst', 'erfasst']);
    expect(state.afterDeploy).toHaveBeenCalledTimes(1);
  });

  it('a missing answer is refused and changes nothing, and nobody is told', async () => {
    const res = await pinMoveHandler(post('move', { version: 1, mappings: {} }));
    expect(res.status).toBe(422);
    expect(pinned()).toBe(3);
    expect(stages()).toEqual(['kontrolliert', 'kontrolliert', 'kontrolliert']);
    expect(state.afterDeploy).not.toHaveBeenCalled();
  });

  it('"Werte verwerfen" unpins without moving the values', async () => {
    const res = await pinMoveHandler(post('move', { version: 1, mappings: { [OPT]: { discard: true } } }));
    expect(await res.json()).toMatchObject({ ok: true, unpinned: 3, moved: 0 });
    expect(pinned()).toBe(0);
  });

  it('a malformed body is a 400', async () => {
    expect((await pinMoveHandler(post('move', { mappings: {} }))).status).toBe(400);
    expect((await pinMoveHandler(post('move', { version: 1, mappings: { a: 'x' } }))).status).toBe(400);
  });
});
