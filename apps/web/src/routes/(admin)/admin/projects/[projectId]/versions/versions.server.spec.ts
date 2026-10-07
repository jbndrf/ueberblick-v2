import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { embedGoldenSource } from '@ueberblick/core/testing';
import { openProject, resolveUpgrade } from '@ueberblick/builder';
import type { OverlayFile, TemplateFile } from '@ueberblick/core';
import {
  addMembership,
  createDraftStore,
  createProject,
  deploy,
  ensureDraft,
  loadConfig,
  publishTemplateFile,
  type Principal,
} from '@ueberblick/server';
import { createVersionsHandlers } from '../../../../../(builder)/versions-handlers';
import type * as Runtime from '../../../../../../lib/server/runtime';
import type * as Page from './+page.server';
import type * as Discard from './discard/+server';
import type * as Move from './move/+server';

// WP-325: the Versionen page's load and actions over the REAL runtime (a project with the golden tree cadastre).
const dir = mkdtempSync(join(tmpdir(), 'ub-admin-versions-'));
const golden = resolve(import.meta.dirname, '../../../../../../../../../fixtures/golden');
const read = (rel: string): string => embedGoldenSource(readFileSync(resolve(golden, rel), 'utf8'));
const template = (v: string): TemplateFile => parse(read(`templates/baumkataster/${v}.yaml`)) as TemplateFile;
const musterstadt = parse(read('projects/musterstadt-baeume.yaml')) as OverlayFile;

let page: typeof Page;
let discard: typeof Discard;
let move: typeof Move;
let handlers: ReturnType<typeof createVersionsHandlers>;
let stop: () => void = () => undefined;
let admin: Principal;
let outsider: Principal;
let participant: Principal;
let rt: ReturnType<typeof Runtime.runtime>;

/** A fresh project per test (`p1`, `p2`, ...): the tests change versions, drafts and the upgrade offer, so none shares state. */
let key = '';
let projects = 0;
let adminId = '';
const url = new URL('http://localhost/admin/projects/muster/versions');
const load = (principal: Principal | null) =>
  (page.load as (e: unknown) => unknown)({
    locals: { admin: principal },
    url,
    params: { projectId: key },
  }) as {
    project: string;
    versions: { version: number; status: string; objektarten: number }[];
    pinned: Record<number, number>;
    upgrade: { offer: { from: string; to: string }; templateSrc: string; overlaySrc: string } | null;
  };
/** The builder routes the page calls (`/builder-api/muster/...`) and the page's own discard route, with a real request. */
const call = async (
  handler: unknown,
  principal: Principal | null,
  params: Record<string, string>,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const res = (await (handler as (e: unknown) => unknown)({
    locals: { admin: principal },
    params: { project: key, projectId: key, ...params },
    request: new Request(url, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  })) as Response;
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const thrown = async (f: () => unknown): Promise<{ status?: number }> => {
  try {
    await f();
  } catch (e) {
    return e as { status?: number };
  }
  return {};
};

beforeAll(async () => {
  process.env['PUBLIC_URL'] = 'http://localhost:3000';
  process.env['DATA_DIR'] = dir;
  process.env['TIMERS_INTERVAL_S'] = '0';
  const { runtime } = await import('../../../../../../lib/server/runtime');
  page = await import('./+page.server');
  discard = await import('./discard/+server');
  move = await import('./move/+server');
  const { authorizeAdmin } = await import('../../../../../../lib/server/authz');
  const { versionsService } = await import('../../../../../../lib/admin/versions/service.server');
  // The builder routes the page calls are one-line exports of these handlers (`(builder)/versions-source.ts`).
  handlers = createVersionsHandlers({
    authorize: authorizeAdmin,
    service: (project) => versionsService(project).service,
    publish: () => ({ ok: false, reason: 'failed' }),
    now: () => rt.clock.now(),
  });
  rt = runtime();
  stop = () => rt.stop();
  for (const v of ['1.0.0', '1.1.0', '2.0.0']) publishTemplateFile(rt.control, template(v), rt.clock);
  const a = await rt.auth.createAdmin('a@example.org', 'correct horse battery');
  const b = await rt.auth.createAdmin('b@example.org', 'correct horse battery');
  adminId = a;
  admin = { kind: 'admin', id: a, projectId: null, roles: [] };
  outsider = { kind: 'admin', id: b, projectId: null, roles: [] };
  participant = { kind: 'participant', id: 'pp', projectId: 'x', roles: [] };
});

beforeEach(() => {
  key = `p${(projects += 1)}`;
  createProject(rt.control, { key, name: key }, rt.clock);
  addMembership(rt.control, { email: 'a@example.org', projectKey: key, role: 'verwaltung' });
  const db = rt.projectDb(key);
  expect(deploy(db, musterstadt, adminId, { clock: rt.clock, templates: rt.templates }).ok).toBe(true);
  expect(ensureDraft(db, rt.clock, adminId).ok).toBe(true);
});

afterAll(() => {
  stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('guard', () => {
  it('signed out goes to the sign-in, a participant and a non-member get 303 / 403', async () => {
    expect((await thrown(() => load(null))).status).toBe(303);
    expect((await thrown(() => load(participant))).status).toBe(303);
    expect((await thrown(() => load(outsider))).status).toBe(403);
  });
});

describe('the list (v3 releases/+page.server.ts)', () => {
  it('has one line per version with the Objektarten count, and marks the deployed one', () => {
    const data = load(admin);
    expect(data.project).toBe(key);
    expect(data.versions).toHaveLength(1);
    expect(data.versions[0]).toMatchObject({ version: 1, status: 'deployed' });
    expect(data.versions[0]?.objektarten).toBeGreaterThan(0);
  });

  it('has no pinned Objekte on a project that never kept any (WP-368)', () => {
    expect(load(admin).pinned).toEqual({});
  });

  it('offers the newer template version (upgrade)', () => {
    expect(load(admin).upgrade?.offer).toMatchObject({ from: '1.1.0', to: '2.0.0' });
  });
});

describe('rollback, compare', () => {
  it('rollback makes the older version the deployed one again; compare reads both files', async () => {
    const db = rt.projectDb(key);
    const changed = structuredClone(musterstadt);
    changed.override = { ...changed.override, 'types.baum.label': { de: 'Baum neu', en: 'Tree new' } };
    expect(deploy(db, changed, 'a', { clock: rt.clock, templates: rt.templates }).ok).toBe(true);
    expect(load(admin).versions.map((v) => [v.version, v.status])).toEqual([
      [2, 'deployed'],
      [1, 'retired'],
    ]);

    expect((await call(handlers.GET_VERSION, admin, { version: '1' })).status).toBe(200);
    expect((await call(handlers.GET_VERSION, admin, { version: '2' })).status).toBe(200);
    expect((await call(handlers.GET_VERSION, admin, { version: '99' })).status).toBe(404);

    const r = await call(handlers.ROLLBACK, admin, {}, { version: 1 });
    expect(r).toMatchObject({ status: 200, body: { ok: true, version: 1 } });
    expect(load(admin).versions.map((v) => [v.version, v.status])).toEqual([
      [2, 'retired'],
      [1, 'deployed'],
    ]);
    expect((await call(handlers.ROLLBACK, admin, {}, { version: 99 })).status).toBe(404);
    expect((await call(handlers.ROLLBACK, outsider, {}, { version: 1 })).status).toBe(403);
  });
});

describe('Entwurf verwerfen', () => {
  it('the draft equals the deployed overlay again and its revision advances', async () => {
    const db = rt.projectDb(key);
    const store = createDraftStore(db);
    const before = store.get();
    if (!before) throw new Error('no draft');
    const edited = openProject(JSON.stringify(template('1.1.0')), before.overlay).apply({
      kind: 'set',
      path: 'types.baum.label',
      value: { de: 'Anders', en: 'Other' },
    });
    expect(edited.refused).toBeUndefined();
    expect(store.putIf(before.revision, edited.doc.save().overlaySrc, 'a', rt.clock.now()).ok).toBe(true);
    const dirty = store.get();
    expect(dirty?.overlay).not.toBe(before.overlay);

    expect(await call(discard.POST, admin, {})).toMatchObject({ status: 200, body: { ok: true } });
    const after = store.get();
    const deployed = db
      .prepare<{ overlay: string }>("SELECT overlay FROM config_versions WHERE status = 'deployed'")
      .get();
    expect(after?.overlay).toBe(stringify(JSON.parse(deployed?.overlay ?? '{}')));
    expect(after?.revision).toBeGreaterThan(dirty?.revision ?? 0);
  });

  it('is for admins of the project only', async () => {
    expect((await call(discard.POST, outsider, {})).status).toBe(403);
    expect((await call(discard.POST, participant, {})).status).toBe(403);
    expect((await call(discard.POST, null, {})).status).toBe(401);
  });
});

describe('Auf aktuelle Version verschieben (WP-368)', () => {
  it('is for admins of the project only, and refuses a version nothing is pinned to', async () => {
    expect((await call(move.POST, outsider, {}, { version: 1, mappings: {} })).status).toBe(403);
    expect((await call(move.POST, participant, {}, { version: 1, mappings: {} })).status).toBe(403);
    expect((await call(move.POST, null, {}, { version: 1, mappings: {} })).status).toBe(401);
    // the deployed version cannot be moved: nothing is pinned to an older version
    expect(await call(move.POST, admin, {}, { version: 1, mappings: {} })).toMatchObject({
      status: 422,
      body: { ok: false },
    });
  });
});

describe('template upgrade', () => {
  it('deploys the resolved overlay on the new template; the offer is gone afterwards', async () => {
    const data = load(admin);
    if (!data.upgrade) throw new Error('no offer');
    const doc = openProject(data.upgrade.templateSrc, data.upgrade.overlaySrc);
    const resolved = resolveUpgrade(
      { old: doc.template, overlay: doc.overlay(), next: template('2.0.0') },
      { conflicts: { 'types.baum.properties.vitalitaet.label': 'overlay' }, unresolved: {} },
    );
    if (!resolved.ok) throw new Error('unresolved');
    const first = await call(handlers.UPGRADE, admin, {}, { overlay: resolved.text, mappings: {} });
    expect(first).toMatchObject({ status: 409, body: { reason: 'mapping_required' } });
    const paths = (first.body['paths'] as string[] | undefined) ?? [];
    expect(paths.length).toBeGreaterThan(0);
    const mappings = Object.fromEntries(paths.map((p) => [p, { discard: true }]));
    const ok = await call(handlers.UPGRADE, admin, {}, { overlay: resolved.text, mappings });
    expect(ok).toMatchObject({ status: 200, body: { ok: true } });
    expect(load(admin).upgrade).toBeNull();
    expect(loadConfig(rt.projectDb(key))?.file.template.version).toBe('2.0.0');
  });
});
