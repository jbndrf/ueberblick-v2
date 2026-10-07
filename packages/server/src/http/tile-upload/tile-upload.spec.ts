import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TemplateFile } from '@ueberblick/core';
import type { Principal } from '../../auth/contract';
import { SESSION_COOKIES } from '../../auth/params';
import { golden } from '../../store/run/testkit';
import { fixtureArchive } from '../../packs/testkit';
import { kit, mbtiles, pyramid, read, type Kit } from '../../tiles/upload/testkit';
import { createArchiveHandler } from '../tiles/archives';
import { createTileUploadHandlers } from './handlers';

let k: Kit;
afterEach(() => k.cleanup());

const SESSIONS: Record<string, Principal> = {
  admin: { kind: 'admin', id: 'admin', projectId: 'p1' } as unknown as Principal,
  member: { kind: 'participant', id: 'member', projectId: 'p1' } as unknown as Principal,
  other: { kind: 'participant', id: 'other', projectId: 'p2' } as unknown as Principal,
};

function world(layerUrl?: string) {
  k = kit();
  const file: TemplateFile = structuredClone(golden('musterstadt-plain').file);
  file.map = {
    layers: {
      eigen: {
        label: { de: 'Eigen' },
        kind: 'overlay',
        source: { type: 'pmtiles', url: layerUrl ?? '/x.pmtiles' },
      },
    },
    packs: {
      region: { label: { de: 'R' }, bounds: [8, 50, 9, 51], min_zoom: 0, max_zoom: 3, layers: ['eigen'] },
    },
  };
  const draftFile: TemplateFile = structuredClone(golden('musterstadt-plain').file);
  draftFile.map = { layers: {} };
  const admin = createTileUploadHandlers({
    authorizeAdmin: (p, key) =>
      p?.kind === 'admin' ? { projectKey: key } : new Response(null, { status: p === null ? 401 : 403 }),
    uploads: k.uploads,
    configs: () => [
      { file, draft: false },
      { file: draftFile, draft: true },
    ],
  });
  const archive = createArchiveHandler({
    auth: {
      authenticate: (id: string | null) =>
        id !== null && id in SESSIONS ? (SESSIONS[id] as Principal) : null,
      toActor: (p: { id: string }) => ({ id: p.id, kind: 'participant', roles: [] }),
      rolesFor: () => ['verwaltung'],
    } as never,
    project: (key) => (key === 'demo' ? { id: 'p1', key } : undefined),
    archivePath: (project, id) => k.uploads.archivePath(project, id),
  });
  const call = (
    as: string | null,
    method: string,
    path: string,
    params: Record<string, string>,
    body?: string | Uint8Array,
    headers = {},
  ) => ({
    request: new Request(`http://x/${path}`, { method, body, headers, duplex: 'half' } as RequestInit),
    params: { project: 'demo', ...params },
    principal: as === null ? null : (SESSIONS[as] as Principal),
  });
  const get = (as: string | null, id: string, headers: Record<string, string> = {}, project = 'demo') =>
    archive(
      new Request(`http://x/api/p/${project}/tiles/archives/${id}.pmtiles`, {
        headers: {
          ...(as === null
            ? {}
            : {
                cookie: Object.values(SESSION_COOKIES)
                  .map((name) => `${name}=${as}`)
                  .join('; '),
              }),
          ...headers,
        },
      }),
      { params: { project, archive: id } },
    );
  return { admin, call, get, file, draftFile };
}

async function uploadAll(w: ReturnType<typeof world>, kind: string, bytes: Uint8Array, chunk = 4000) {
  const start = w.call(
    'admin',
    'POST',
    'u',
    {},
    JSON.stringify({ kind, name: 'Luftbild', size: bytes.length }),
  );
  const job = (await (await w.admin.start(start)).json()) as { id: string };
  for (let at = 0; at < bytes.length; at += chunk)
    await w.admin.chunk(
      w.call('admin', 'PUT', `u?offset=${at}`, { id: job.id }, bytes.subarray(at, at + chunk)),
    );
  expect(w.admin.finish(w.call('admin', 'POST', 'f', { id: job.id })).status).toBe(202);
  await k.uploads.idle();
  const status = (await w.admin.status(w.call('admin', 'GET', 's', { id: job.id })).json()) as {
    state: string;
    result?: { url: string; archive: string };
  };
  return { id: job.id, status };
}

describe('admin endpoints', () => {
  it('upload, finish and poll: the status carries the result; anonymous 401, a participant 403', async () => {
    const w = world();
    mbtiles(join(k.dir, 'a.mbtiles'), pyramid(2), { bounds: '6,48,10,52' });
    const { status } = await uploadAll(w, 'mbtiles', read(join(k.dir, 'a.mbtiles')));
    expect(status).toMatchObject({
      state: 'done',
      result: { format: 'png', bounds: [6, 48, 10, 52], minZoom: 0, maxZoom: 2, tiles: 21 },
    });
    expect((await w.admin.start(w.call(null, 'POST', 'u', {}, '{}'))).status).toBe(401);
    const asMember = await w.admin.start(w.call('member', 'POST', 'u', {}, '{}'));
    expect(asMember.status).toBe(403);
  });

  it('answers refusals with a typed reason and the bytes received', async () => {
    const w = world();
    const start = await w.admin.start(
      w.call('admin', 'POST', 'u', {}, JSON.stringify({ kind: 'pmtiles', name: 'x', size: 500 })),
    );
    const { id } = (await start.json()) as { id: string };
    const gap = await w.admin.chunk(w.call('admin', 'PUT', 'u?offset=100', { id }, new Uint8Array(10)));
    expect(gap.status).toBe(409);
    expect(await gap.json()).toMatchObject({
      error: { code: 'upload_refused', reason: 'bad_chunk', received: 0 },
    });
    const big = await w.admin.start(
      w.call('admin', 'POST', 'u', {}, JSON.stringify({ kind: 'zip', name: 'x', size: 9e12 })),
    );
    expect(big.status).toBe(413);
    expect(await big.json()).toMatchObject({ error: { reason: 'too_large' } });
    const bad = await w.admin.start(w.call('admin', 'POST', 'u', {}, JSON.stringify({ kind: 'pmtiles' })));
    expect(bad.status).toBe(400);
    const none = w.admin.status(w.call('admin', 'GET', 's', { id: 'ffffffffffffffff' }));
    expect(none.status).toBe(404);
  });

  it('a failed conversion is a failed status with a reason, not an HTTP error', async () => {
    const w = world();
    const { status } = await uploadAll(w, 'pmtiles', new Uint8Array(300).fill(2));
    expect(status).toMatchObject({ state: 'failed', error: { reason: 'corrupt' } });
  });
});

describe('serving', () => {
  it('range requests return the right bytes; the whole file answers 200', async () => {
    const w = world();
    const bytes = await fixtureArchive(2);
    const { id } = await uploadAll(w, 'pmtiles', bytes);
    const part = await w.get('member', id, { range: 'bytes=10-29' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 10-29/${bytes.length}`);
    expect(Buffer.from(await part.arrayBuffer()).equals(Buffer.from(bytes.subarray(10, 30)))).toBe(true);
    const tail = await w.get('admin', id, { range: 'bytes=-5' });
    expect(Buffer.from(await tail.arrayBuffer()).equals(Buffer.from(bytes.subarray(bytes.length - 5)))).toBe(
      true,
    );
    const all = await w.get('member', id);
    expect(all.status).toBe(200);
    expect(Buffer.from(await all.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);
    expect((await w.get('member', id, { range: `bytes=${bytes.length + 5}-` })).status).toBe(416);
  });

  it('an anonymous caller gets 401, a participant of another project 403, an unknown archive 404', async () => {
    const w = world();
    const { id } = await uploadAll(w, 'pmtiles', await fixtureArchive(1));
    expect((await w.get(null, id)).status).toBe(401);
    expect((await w.get('other', id)).status).toBe(403);
    expect((await w.get('member', 'ffffffffffffffff')).status).toBe(404);
    expect((await w.get('member', '../x')).status).toBe(404);
  });
});

describe('delete', () => {
  it('is refused with the referencing keys while a layer or a pack uses the archive', async () => {
    const w = world();
    const { id } = await uploadAll(w, 'pmtiles', await fixtureArchive(1));
    const url = `/api/p/demo/tiles/archives/${id}.pmtiles`;
    const file = w.file.map;
    if (file?.layers['eigen']?.source.type === 'pmtiles') file.layers['eigen'].source.url = url;
    const refused = await w.admin.remove(w.call('admin', 'DELETE', 'd', { archive: id }));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      error: { code: 'conflict', references: ['map.layers.eigen', 'map.packs.region'] },
    });
    expect((await w.get('member', id)).status).toBe(200);
    if (file?.layers['eigen']?.source.type === 'pmtiles') file.layers['eigen'].source.url = '/other.pmtiles';
    expect((await w.admin.remove(w.call('admin', 'DELETE', 'd', { archive: id }))).status).toBe(204);
    expect((await w.get('member', id)).status).toBe(404);
    expect((await w.admin.remove(w.call('admin', 'DELETE', 'd', { archive: id }))).status).toBe(404);
  });

  it('is refused while only the draft uses the archive, naming the key as a draft key', async () => {
    const w = world();
    const { id } = await uploadAll(w, 'pmtiles', await fixtureArchive(1));
    w.draftFile.map = {
      layers: {
        neu: {
          label: { de: 'Neu' },
          kind: 'overlay',
          source: { type: 'pmtiles', url: `/api/p/demo/tiles/archives/${id}.pmtiles` },
        },
      },
    };
    const refused = await w.admin.remove(w.call('admin', 'DELETE', 'd', { archive: id }));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { references: ['map.layers.neu (Entwurf)'] } });
    w.draftFile.map = { layers: {} };
    expect((await w.admin.remove(w.call('admin', 'DELETE', 'd', { archive: id }))).status).toBe(204);
  });

  it('is for admins only', async () => {
    const w = world();
    expect(
      (await w.admin.remove(w.call('member', 'DELETE', 'd', { archive: 'ffffffffffffffff' }))).status,
    ).toBe(403);
  });
});
