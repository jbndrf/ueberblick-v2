import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Principal } from '@ueberblick/server';
import type { SettingsPageData } from '../../../../../../lib/admin/settings/types';

// WP-387: Status & Freigabe, Infoseiten and Offline-Pakete over the REAL runtime: the load, the draft edits, publishing,
// and the pack status through the existing admin endpoint.
const dir = mkdtempSync(join(tmpdir(), 'ub-admin-settings-entries-'));
let stop: () => void = () => undefined;
let admin: Principal;
let KEY = 'musterstadt';
let testNo = 0;
let status: () => { dirty: boolean; neverPublished: boolean };
let publish: () => void;
let deployedFile: () =>
  { info_pages?: Record<string, unknown>; map?: { packs?: Record<string, unknown> } } | undefined;
let addLayer: () => void;
let packList: () => Promise<{ status: number; packs: { key: string; state: string }[] }>;

const url = () => new URL(`http://localhost/admin/projects/${KEY}/settings`);
const call = (principal: Principal | null, body?: unknown) => ({
  locals: { admin: principal },
  params: { project: KEY, projectId: KEY },
  url: url(),
  cookies: { get: () => undefined },
  request: new Request(url(), {
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }),
});
const load = (): SettingsPageData => (page.load as (e: unknown) => SettingsPageData)(call(admin));
const post = async (body: unknown) => {
  const r = await settings.POST(call(admin, body) as never);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> & Partial<SettingsPageData> };
};
const PAGE = { action: 'info_page', title: 'Datenschutz', content: '<p>Hallo $token</p>', sortOrder: 2 };
const PACK = {
  action: 'pack',
  name: 'Innenstadt',
  minZoom: 12,
  maxZoom: 14,
  bounds: [7.08, 50.7, 7.14, 50.75],
  layers: ['luft'],
  roles: [],
};

process.env['PUBLIC_URL'] = 'http://localhost:3000';
process.env['DATA_DIR'] = dir;
process.env['TIMERS_INTERVAL_S'] = '0';
const { runtime } = await import('../../../../../../lib/server/runtime');
const { draftStatus, createDraftStore, createProjectFromTemplate, deploy } =
  await import('@ueberblick/server');
const { parse, stringify } = await import('yaml');
const { adminPacksRoute } = await import('../../../../../../lib/server/handlers/admin-packs');
const page = await import('./+page.server');
const settings = await import('./+server');

beforeAll(async () => {
  const rt = runtime();
  stop = () => rt.stop();
  status = () => draftStatus(rt.projectDb(KEY), { clock: rt.clock, templates: rt.templates });
  publish = () => {
    const overlay = createDraftStore(rt.projectDb(KEY)).get()?.overlay ?? '';
    const done = deploy(rt.projectDb(KEY), parse(overlay), admin.id, {
      clock: rt.clock,
      templates: rt.templates,
    });
    if (!done.ok) throw new Error(JSON.stringify(done.problems));
  };
  deployedFile = () => rt.services.deployed(KEY)?.config.file as never;
  // a pmtiles layer on a closed port: packable, and its build fails at once (no network in a test)
  addLayer = () => {
    const store = createDraftStore(rt.projectDb(KEY));
    const draft = store.get();
    if (!draft) throw new Error('no draft');
    const overlay = parse(draft.overlay) as { add?: Record<string, unknown> };
    overlay.add = {
      ...overlay.add,
      'map.layers.luft': {
        label: { de: 'Luftbild' },
        kind: 'base',
        source: { type: 'pmtiles', url: 'http://127.0.0.1:9/luft.pmtiles', tile_type: 'raster' },
      },
    };
    store.putIf(draft.revision, stringify(overlay), admin.id, rt.clock.now());
  };
  packList = async () => {
    const r = await adminPacksRoute('list')({
      request: new Request(`http://localhost/api/admin/p/${KEY}/packs`),
      params: { project: KEY },
      locals: { admin: admin },
    } as never);
    return { status: r.status, packs: ((await r.json()) as { packs: never }).packs ?? [] };
  };
  const a = await rt.auth.createAdmin('e@example.org', 'correct horse battery');
  admin = { kind: 'admin', id: a, projectId: null, roles: [] };
});

beforeEach(() => {
  const rt = runtime();
  testNo += 1;
  KEY = createProjectFromTemplate(
    rt.control,
    rt.projectDb,
    { name: `Eintragsstadt ${testNo}`, description: '', template: 'leer@1' },
    admin.id,
    rt.clock,
  ).key;
});

afterAll(() => {
  stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('Status & Freigabe (the load)', () => {
  it('a project that was never published: draft, no version, the Objektarten with 0 objects', () => {
    const l = load().lifecycle;
    expect(l).toMatchObject({ version: null, neverPublished: true, blockerCount: 0, other: [] });
    expect(Array.isArray(l.types)).toBe(true);
  });
  it('after publishing: live with a version and nothing unpublished; a draft edit makes it dirty', async () => {
    publish();
    expect(load().lifecycle).toMatchObject({ version: 1, neverPublished: false, dirty: false });
    await post(PAGE);
    expect(load().lifecycle).toMatchObject({ version: 1, dirty: true });
  });
  it('a blocker names its Objektart, or goes to "other" when it belongs to none', async () => {
    publish();
    await post(PAGE);
    addLayer();
    // a pack naming a role the file does not have is a compile problem at map.packs.<key>.roles[0]
    expect((await post({ ...PACK, roles: ['gibtsnicht'] })).status).toBe(200);
    const l = load().lifecycle;
    expect(l.blockerCount).toBeGreaterThan(0);
    expect(l.other.join(' ')).toContain('gibtsnicht');
  });
});

describe('Infoseiten', () => {
  it('create, edit and order round-trip through the draft and the published file; delete removes it', async () => {
    publish();
    const created = await post(PAGE);
    expect(created.status).toBe(200);
    expect(created.body.infoPages).toMatchObject([
      { key: 'datenschutz', title: 'Datenschutz', sortOrder: 2 },
    ]);
    expect(status().dirty).toBe(true);
    await post({ action: 'info_page', title: 'Impressum', content: '<p>I</p>', sortOrder: 1 });
    const edited = await post({ ...PAGE, key: 'datenschutz', title: 'Datenschutz neu', sortOrder: 0 });
    expect(edited.body.infoPages?.map((p) => [p.key, p.title])).toEqual([
      ['datenschutz', 'Datenschutz neu'],
      ['impressum', 'Impressum'],
    ]);
    expect(load().infoPages).toHaveLength(2);
    publish();
    expect(Object.keys(deployedFile()?.info_pages ?? {})).toEqual(['datenschutz', 'impressum']);
    const gone = await post({ action: 'info_page_delete', key: 'impressum' });
    expect(gone.body.infoPages).toHaveLength(1);
    publish();
    expect(Object.keys(deployedFile()?.info_pages ?? {})).toEqual(['datenschutz']);
  });
  it('refuses an empty title, an unknown key and a wrong shape', async () => {
    publish();
    expect((await post({ ...PAGE, title: ' ' })).body.error).toBe('invalid');
    expect((await post({ ...PAGE, key: 'nope' })).body.error).toBe('not_found');
    expect((await post({ action: 'info_page_delete', key: 'nope' })).body.message).toEqual({
      de: 'Der Eintrag ist nicht mehr im Entwurf',
      en: 'The entry is no longer in the draft',
    });
    expect((await post({ ...PAGE, title: 5 })).status).toBe(400);
    expect((await post({ ...PAGE, key: 'Bad Key' })).status).toBe(400);
    expect(status().dirty).toBe(false);
  });
});

describe('Offline-Pakete', () => {
  it('a pack is defined in the draft, builds after publishing through the existing endpoint and shows its state', async () => {
    publish();
    addLayer();
    expect(load().packLayers).toMatchObject([{ key: 'luft' }]);
    const made = await post(PACK);
    expect(made.status).toBe(200);
    expect(made.body.packs).toMatchObject([
      { key: 'innenstadt', name: 'Innenstadt', layers: ['luft'], roles: [] },
    ]);
    expect(made.body.packLayers).toMatchObject([{ key: 'luft', packable: true }]);
    expect(load().packs).toHaveLength(1);
    expect((await packList()).packs).toEqual([]); // not published: nothing is built yet
    publish();
    expect(Object.keys(deployedFile()?.map?.packs ?? {})).toEqual(['innenstadt']);
    const listed = await packList();
    expect(listed.status).toBe(200);
    expect(listed.packs).toHaveLength(1);
    expect(['queued', 'building', 'failed', 'ready']).toContain(listed.packs[0]?.state);
  });
  it('roles can be set on a pack alone, a pack can be deleted, an unknown pack is not_found', async () => {
    publish();
    addLayer();
    await post(PACK);
    const roles = await post({ action: 'pack_roles', key: 'innenstadt', roles: [] });
    expect(roles.body.packs).toMatchObject([{ key: 'innenstadt', roles: [] }]);
    expect((await post({ action: 'pack_delete', key: 'innenstadt' })).body.packs).toEqual([]);
    expect((await post({ action: 'pack_delete', key: 'innenstadt' })).body.error).toBe('not_found');
  });
  it('refuses a pack with no layer, a reversed zoom range and a box that is not a box', async () => {
    publish();
    addLayer();
    expect((await post({ ...PACK, layers: [] })).body.error).toBe('invalid');
    expect((await post({ ...PACK, minZoom: 15, maxZoom: 12 })).body.error).toBe('invalid');
    expect((await post({ ...PACK, bounds: [1, 2, 3] })).status).toBe(400);
  });
});
