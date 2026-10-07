import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '../../auth/contract';
import { openProjectDb } from '../../db/open';
import { deployProject } from '../../deploy/deploy-project';
import { deployedVersion, loadData } from '../../deploy/versions';
import { createPackBuilder } from '../../packs/builder';
import type { FetchRange } from '../../packs/fetch';
import { fixtureArchive, must, packFile, serve } from '../../packs/testkit';
import { createAdminPackHandlers } from './handlers';
import type { PackStatus } from './status';

const NOW = '2026-10-02T10:00:00.000Z';
const ADMIN = { kind: 'admin', id: 'a1' } as unknown as Principal;
const GUEST = { kind: 'participant', id: 'p1' } as unknown as Principal;
let archive: Uint8Array;
beforeAll(async () => {
  archive = await fixtureArchive(4);
});

function world(fetchRange: FetchRange = serve(archive).fetchRange) {
  const db = openProjectDb(':memory:', 'demo');
  const file = packFile({ innen: { bounds: [7.08, 50.7, 7.14, 50.75], min_zoom: 2, max_zoom: 8 } });
  deployProject(db, file, 'admin', { clock: { now: () => NOW }, afterDeploy: () => undefined });
  const current = () => must(loadData(db, must(deployedVersion(db)).version)).file;
  const builder = createPackBuilder({
    db,
    dir: mkdtempSync(join(tmpdir(), 'ap-')),
    clock: { now: () => NOW },
    file: current,
    fetchRange,
  });
  const kicks: string[] = [];
  const handlers = createAdminPackHandlers({
    authorizeAdmin: (p, key) =>
      p === null
        ? new Response('no', { status: 401 })
        : p === GUEST
          ? new Response('no', { status: 403 })
          : { projectKey: key },
    db: () => db,
    deployed: () => ({ version: 1, config: { file: current() } as never }),
    clock: { now: () => NOW },
    kick: (k) => void kicks.push(k),
  });
  const call = (key?: string, principal: Principal | null = ADMIN) => ({
    request: new Request('http://x/api/admin/p/demo/packs'),
    params: { project: 'demo', ...(key === undefined ? {} : { key }) },
    principal,
  });
  return { db, builder, handlers, call, kicks };
}

const list = async (w: ReturnType<typeof world>): Promise<PackStatus[]> =>
  ((await w.handlers.list(w.call()).json()) as { packs: PackStatus[] }).packs;

describe('GET /api/admin/p/<project>/packs', () => {
  it('lists definition, estimate, state, progress and bytes: queued, then ready', async () => {
    const w = world();
    const [queued] = await list(w);
    expect(queued).toMatchObject({
      key: 'innen',
      label: { de: 'innen' },
      min_zoom: 2,
      max_zoom: 8,
      state: 'queued',
      built_at: null,
      progress: { tiles_done: 0 },
    });
    expect(queued?.estimate.tiles).toBeGreaterThan(0);
    expect(queued?.layers[0]?.estimate.max_zoom).toBe(8);
    await w.builder.drain();
    const [ready] = await list(w);
    expect(ready).toMatchObject({ state: 'ready', built_at: NOW, error: null });
    expect(ready?.bytes).toBeGreaterThan(0);
    expect(ready?.progress.tiles_done).toBe(ready?.progress.tiles_total);
    expect(ready?.layers[0]).toMatchObject({ state: 'ready', max_zoom: 4 }); // capped at the archive's max zoom
  });

  it('is refused for a participant and without a session', () => {
    const w = world();
    expect(w.handlers.list(w.call(undefined, GUEST)).status).toBe(403);
    expect(w.handlers.list(w.call(undefined, null)).status).toBe(401);
    expect(w.handlers.rebuild(w.call('innen', GUEST)).status).toBe(403);
    expect(w.handlers.rebuild(w.call('innen', null)).status).toBe(401);
  });
});

describe('POST /api/admin/p/<project>/packs/<key>/rebuild', () => {
  it('re-enqueues a failed pack, refuses a pack that did not fail, and 404s an unknown key', async () => {
    const down = world(async () => {
      throw new Error('tile host down');
    });
    await down.builder.drain();
    expect((await list(down))[0]).toMatchObject({ state: 'failed', error: 'tile host down' });
    expect(down.handlers.rebuild(down.call('innen')).status).toBe(200);
    expect(down.kicks).toEqual(['demo']);
    expect((await list(down))[0]?.state).toBe('queued');
    expect(down.handlers.rebuild(down.call('innen')).status).toBe(409); // queued is not failed
    expect(down.handlers.rebuild(down.call('nope')).status).toBe(404);
  });
});
