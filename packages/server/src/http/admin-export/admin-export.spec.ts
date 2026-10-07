// WP-384: the export endpoints (ZIP, CSV, GeoPackage) and the ZIP import job over HTTP.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { Json } from '@ueberblick/core';
import type { Principal } from '../../auth/contract';
import { createBlobs, fileBlobStore } from '../../blobs';
import { openSqlite } from '../../db/driver';
import { ARCHIVE_ENTRIES, ARCHIVE_ZIP_LIMITS } from '../../io/archive/manifest';
import { importArchive } from '../../io/archive/import-zip';
import { openZip } from '../../io/archive/zip';
import { fid, setup } from '../../store/run/testkit';
import { syncSetup } from '../../sync/testkit';
import { createAdminExportHandlers, createArchiveImportHandlers } from './index';

const ADMIN = { kind: 'admin', id: 'a1' } as unknown as Principal;
const PARTICIPANT = { kind: 'participant', id: 'p1' } as unknown as Principal;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function world(opts: { deployed?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'admin-export-spec-'));
  dirs.push(dir);
  const ctx = syncSetup();
  ctx.seed([
    {
      id: fid(1),
      type: 'baum',
      properties: {
        stage: 'erfasst',
        zustaendig: 'anna',
        befund: 'Ärger, "Quote"',
        hoehe_m: 12.5,
        geometrie: { type: 'Point', coordinates: [7.1, 50.7] } as unknown as Json,
      },
    },
    {
      id: fid(2),
      type: 'baum',
      properties: {
        stage: 'erfasst',
        geometrie: { type: 'Point', coordinates: [7.2, 50.7] } as unknown as Json,
      },
    },
  ]);
  const blobs = createBlobs({ db: ctx.db, store: fileBlobStore(join(dir, 'blobs')), clock: ctx.deps.clock });
  const handlers = createAdminExportHandlers({
    authorizeAdmin: (p, key) =>
      p === null
        ? new Response('no', { status: 401 })
        : p.kind !== 'admin'
          ? new Response('no', { status: 403 })
          : { projectKey: key },
    db: () => ctx.db,
    deployed: () => (opts.deployed === false ? undefined : { version: 1, config: ctx.config }),
    project: () => ({ name: 'Bäume Süd', description: 'd' }),
    effectiveFile: () => ({ ok: true, file: ctx.config.file }),
    visible: () => (a, alias) => ctx.service.visible(a, alias),
    blobs: () => blobs,
    now: () => '2026-10-02T10:00:00.000Z',
  });
  const call = (path: string, principal: Principal | null = ADMIN) => ({
    request: new Request(`http://x/api/admin/p/demo/export/${path}`),
    params: { project: 'demo' },
    principal,
  });
  return { ctx, handlers, call, dir, exporter: handlers };
}

const bytesOf = async (res: Response | Promise<Response>): Promise<Buffer> =>
  Buffer.from(await (await res).arrayBuffer());

describe('export endpoints', () => {
  it.each(['zip', 'csv', 'gpkg'] as const)('%s: 401 without a session, 403 for a participant', (kind) => {
    const w = world();
    expect(w.handlers[kind](w.call(kind, null)).status).toBe(401);
    expect(w.handlers[kind](w.call(kind, PARTICIPANT)).status).toBe(403);
  });

  it('zip: streams a ZIP with the manifest, the project file and the data, named after the project', async () => {
    const w = world();
    const res = w.handlers.zip(w.call('zip'));
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('baeume-sued.zip');
    const path = join(w.dir, 'p.zip');
    writeFileSync(path, await bytesOf(res));
    const zip = await openZip(path, ARCHIVE_ZIP_LIMITS);
    const manifest = JSON.parse(await zip.text(ARCHIVE_ENTRIES.manifest)) as {
      types: Record<string, unknown>;
    };
    expect(manifest.types['baum']).toEqual({ count: 2 });
    expect((parse(await zip.text(ARCHIVE_ENTRIES.file)) as { schema: string }).schema).toBe('ueberblick/1');
    expect(await zip.text(ARCHIVE_ENTRIES.data('baum'))).toContain('Ärger');
  });

  it('zip: a project that was never deployed still exports its file', async () => {
    const w = world({ deployed: false });
    const path = join(w.dir, 'd.zip');
    writeFileSync(path, await bytesOf(w.handlers.zip(w.call('zip'))));
    const zip = await openZip(path, ARCHIVE_ZIP_LIMITS);
    expect(JSON.parse(await zip.text(ARCHIVE_ENTRIES.manifest))).toMatchObject({
      deployed: false,
      types: {},
    });
  });

  it('csv?type: the data page columns, v3 quoting, a BOM, one row per feature', async () => {
    const w = world();
    const res = w.handlers.csv(w.call('csv?type=baum'));
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('baeume-sued-baum.csv');
    const text = (await bytesOf(res)).toString('utf8');
    expect(text.startsWith('﻿')).toBe(true);
    const [header, ...rows] = text.slice(1).trim().split('\n');
    expect(header).toContain('befund');
    expect(header).toContain('$id');
    expect(header?.endsWith('lon,lat')).toBe(true);
    expect(rows).toHaveLength(2);
    expect(text).toContain('"Ärger, ""Quote"""');
    expect(text).toContain('7.1,50.7');
  });

  it('csv: no type gives a ZIP with one CSV per Objektart', async () => {
    const w = world();
    const res = w.handlers.csv(w.call('csv'));
    expect(res.headers.get('content-type')).toBe('application/zip');
    const path = join(w.dir, 'c.zip');
    writeFileSync(path, await bytesOf(res));
    const zip = await openZip(path, ARCHIVE_ZIP_LIMITS);
    expect(zip.entries.map((e) => e.name)).toEqual(
      expect.arrayContaining(['baum.csv', 'baumart.csv', 'flaeche.csv']),
    );
    expect(await zip.text('baum.csv')).toContain('Ärger');
  });

  it('csv and gpkg: an unknown type is 404, a project without a deployed config is 409', () => {
    const w = world();
    expect(w.handlers.csv(w.call('csv?type=nope')).status).toBe(404);
    expect(w.handlers.gpkg(w.call('gpkg?type=nope')).status).toBe(404);
    const undeployed = world({ deployed: false });
    expect(undeployed.handlers.csv(undeployed.call('csv?type=baum')).status).toBe(409);
    expect(undeployed.handlers.gpkg(undeployed.call('gpkg')).status).toBe(409);
  });

  it('gpkg: a GeoPackage with the Objektart as a layer and its rows', async () => {
    const w = world();
    const res = w.handlers.gpkg(w.call('gpkg?type=baum'));
    expect(res.headers.get('content-disposition')).toContain('baeume-sued-baum.gpkg');
    const path = join(w.dir, 'x.gpkg');
    writeFileSync(path, await bytesOf(res));
    const db = openSqlite(path);
    expect(db.prepare<{ n: number }>('SELECT count(*) AS n FROM baum').get()?.n).toBe(2);
    db.close();
  });
});

describe('ZIP import job', () => {
  function importWorld(maxBytes?: number) {
    const w = world();
    const target = setup();
    const runs: { path: string; name: string | undefined; by: string }[] = [];
    const handlers = createArchiveImportHandlers({
      run: async (path, name, by, progress) => {
        runs.push({ path, name, by });
        progress(1, 4);
        const r = await importArchive(
          {
            createProject: (text) => ({ ok: true, key: 'neu', fileText: text }),
            putLive: () => ({ ok: true, version: 1 }),
            removeProject: () => undefined,
            usedTokens: () => new Set(),
            rosterTarget: () => {
              throw new Error('no roster');
            },
            store: () => target.store,
            blobs: () =>
              createBlobs({
                db: target.db,
                store: fileBlobStore(join(w.dir, 'b2')),
                clock: target.deps.clock,
              }),
            ids: target.deps.ids,
          },
          path,
          name,
        );
        return r;
      },
      newId: () => 'job-1',
      ...(maxBytes === undefined ? {} : { maxBytes }),
    });
    const post = (body: string | Buffer | null, principal: Principal | null = ADMIN, query = '') => ({
      request: new Request(`http://x/api/admin/projects/import-zip${query}`, {
        method: 'POST',
        body,
        duplex: 'half',
      } as RequestInit),
      params: {},
      principal,
    });
    const status = (principal: Principal | null = ADMIN, job = 'job-1') => ({
      request: new Request('http://x/'),
      params: { job },
      principal,
    });
    return { ...w, target, handlers, runs, post, status };
  }

  it('takes the ZIP as the body, answers 202 with a job and reports it failed when the archive is refused', async () => {
    const w = importWorld();
    const res = await w.handlers.start(w.post('not a zip', ADMIN, '?name=Kopie'));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ job: 'job-1' });
    await w.handlers.idle();
    expect(w.runs[0]).toMatchObject({ name: 'Kopie', by: 'a1' });
    const job = (
      (await w.handlers.status(w.status()).json()) as { job: { state: string; problems: unknown[] } }
    ).job;
    expect(job.state).toBe('failed');
    expect(job.problems.length).toBeGreaterThan(0);
  });

  it('streams a body of many chunks to disk (50 KB of any bytes) and answers 202', async () => {
    const w = importWorld();
    const body = Buffer.from(Array.from({ length: 50_000 }, (_, i) => (i * 31) % 256));
    const res = await w.handlers.start(w.post(body));
    expect(res.status).toBe(202);
    await w.handlers.idle();
  });

  it('imports a real archive: the job ends done with the new project key', async () => {
    const w = importWorld();
    const zip = await bytesOf(w.exporter.zip(w.call('zip')));
    const res = await w.handlers.start(w.post(zip));
    expect(res.status).toBe(202);
    await w.handlers.idle();
    const job = ((await w.handlers.status(w.status()).json()) as { job: Record<string, unknown> }).job;
    expect(job).toMatchObject({ state: 'done', key: 'neu' });
    expect(w.target.db.prepare<{ n: number }>('SELECT count(*) AS n FROM features').get()?.n).toBe(2);
  });

  it('refuses 401, 403, a declared size over the cap (413), an unknown job (404)', async () => {
    const w = importWorld(10);
    expect((await w.handlers.start(w.post('x', null))).status).toBe(401);
    expect((await w.handlers.start(w.post('x', PARTICIPANT))).status).toBe(403);
    expect((await w.handlers.start(w.post('x'.repeat(100)))).status).toBe(413);
    expect(w.handlers.status(w.status(ADMIN, 'nope')).status).toBe(404);
    expect(w.handlers.status(w.status(null)).status).toBe(401);
    expect(w.runs).toEqual([]);
  });
});
