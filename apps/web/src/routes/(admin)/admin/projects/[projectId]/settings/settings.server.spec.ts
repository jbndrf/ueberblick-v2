import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Principal } from '@ueberblick/server';
import type { SettingsPageData } from '../../../../../../lib/admin/settings/types';

// WP-375: the Projekteinstellungen page's server side over the REAL runtime: the load and the draft edits (Doc ops).
const dir = mkdtempSync(join(tmpdir(), 'ub-admin-settings-'));
let stop: () => void = () => undefined;
let status: () => { dirty: boolean };
let publish: () => void;
let deployedFile: () => { branding?: unknown; map?: unknown; tools?: unknown } | undefined;
let admin: Principal;
let outsider: Principal;
let KEY = 'musterstadt';
let testNo = 0;
const SHA = 'cd'.repeat(32);

const url = () => new URL(`http://localhost/admin/projects/${KEY}/settings`);
const call = (principal: Principal | null, body?: unknown, site = 'same-origin') => ({
  locals: { admin: principal },
  params: { project: KEY, projectId: KEY },
  url: url(),
  cookies: { get: () => undefined },
  request: new Request(url(), {
    method: 'POST',
    headers: { 'sec-fetch-site': site, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }),
});
const load = (principal: Principal | null): SettingsPageData =>
  (page.load as (e: unknown) => SettingsPageData)(call(principal));
const post = async (body: unknown, principal: Principal | null = admin, site?: string) => {
  const r = await settings.POST(call(principal, body, site) as never);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> & Partial<SettingsPageData> };
};
const MAP = { action: 'map', lat: 50.7, lng: 7.1, zoom: 12, minZoom: 4, maxZoom: 17 };

process.env['PUBLIC_URL'] = 'http://localhost:3000';
process.env['DATA_DIR'] = dir;
process.env['TIMERS_INTERVAL_S'] = '0';
const { runtime } = await import('../../../../../../lib/server/runtime');
const { draftStatus, createDraftStore, createProjectFromTemplate, deploy } =
  await import('@ueberblick/server');
const { parse } = await import('yaml');
const page = await import('./+page.server');
const settings = await import('./+server');
const { addRoleToDraft } = await import('../participants/draft-roles.server');

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
  const a = await rt.auth.createAdmin('a@example.org', 'correct horse battery');
  const b = await rt.auth.createAdmin('b@example.org', 'correct horse battery');
  admin = { kind: 'admin', id: a, projectId: null, roles: [] };
  outsider = { kind: 'admin', id: b, projectId: null, roles: [] };
});

beforeEach(() => {
  const rt = runtime();
  testNo += 1;
  KEY = createProjectFromTemplate(
    rt.control,
    rt.projectDb,
    { name: `Musterstadt ${testNo}`, description: '', template: 'leer@1' },
    admin.id,
    rt.clock,
  ).key;
  publish(); // the first version: from here on `dirty` means a change of the draft
});

afterAll(() => {
  stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('the load', () => {
  it('shows the project name, no branding and v3 map defaults for a fresh project', () => {
    const data = load(admin);
    expect(data.projectName).toBe(`Musterstadt ${testNo}`);
    expect(data.branding).toEqual({ name: '', icon: null });
    expect(data.map).toMatchObject({ zoom: 10, minZoom: 1, maxZoom: 19, saved: false });
  });
  it('is guarded like the admin area', () => {
    expect(() => load(null)).toThrow();
    expect(() => load(outsider)).toThrow();
  });
});

describe('branding is saved into the draft (E-5)', () => {
  it('name and icon go to the draft, the publish bar shows it, publishing makes them the deployed config', async () => {
    expect(status().dirty).toBe(false);
    expect((await post({ action: 'branding', name: 'Stadt-App' })).status).toBe(200);
    const r = await post({ action: 'branding', icon: SHA });
    expect(r.body.branding).toEqual({ name: 'Stadt-App', icon: SHA });
    expect(status().dirty).toBe(true);
    expect(load(admin).branding).toEqual({ name: 'Stadt-App', icon: SHA });
    publish();
    expect(status().dirty).toBe(false);
    expect(deployedFile()?.branding).toEqual({ name: 'Stadt-App', icon: SHA });
  });
  it('remove clears the icon, an empty name clears the name', async () => {
    await post({ action: 'branding', name: 'X', icon: SHA });
    expect((await post({ action: 'branding', icon: null })).body.branding).toEqual({ name: 'X', icon: null });
    expect((await post({ action: 'branding', name: '' })).body.branding).toEqual({ name: '', icon: null });
  });
  it('refuses a bad sha, another origin, a foreign admin and no session', async () => {
    expect((await post({ action: 'branding', icon: 'logo.png' })).status).toBe(400);
    expect((await post({ action: 'branding', name: 'X' }, admin, 'cross-site')).status).toBe(403);
    expect((await post({ action: 'branding', name: 'X' }, outsider)).status).toBe(403);
    expect((await post({ action: 'branding', name: 'X' }, null)).status).toBe(401);
    expect((await post({ action: 'nope' })).status).toBe(400);
  });
});

describe('the Standardansicht is saved into map.start, map.min_zoom and map.max_zoom', () => {
  it('saves into the draft and publishes', async () => {
    const r = await post(MAP);
    expect(r.status).toBe(200);
    expect(r.body.map).toEqual({ lat: 50.7, lng: 7.1, zoom: 12, minZoom: 4, maxZoom: 17, saved: true });
    expect(status().dirty).toBe(true);
    publish();
    expect(deployedFile()?.map).toMatchObject({
      start: { center: [7.1, 50.7], zoom: 12 },
      min_zoom: 4,
      max_zoom: 17,
    });
  });
  it('refuses min above max and a zoom outside the bounds in both languages, and changes nothing', async () => {
    const bad = await post({ ...MAP, minZoom: 15, maxZoom: 5 });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid');
    expect(bad.body.message).toEqual({ de: 'Ungültiger Wert', en: 'Invalid value' });
    expect((await post({ ...MAP, zoom: 2 })).status).toBe(400);
    expect((await post({ ...MAP, lat: 91 })).status).toBe(400);
    expect(status().dirty).toBe(false);
  });
});

describe("the Chat section is saved into tools.chat and the roles' app.tools (WP-391)", () => {
  it('a fresh project has no chat and lists no roles', () => {
    expect(load(admin).chat).toEqual({ enabled: false, all: false, roles: [], options: [] });
  });
  it('on declares the tool in the draft and publishing makes it the deployed config; off removes it again', async () => {
    const on = await post({ action: 'chat', enabled: true, roles: [] });
    expect(on.status).toBe(200);
    expect(on.body.chat?.enabled).toBe(true);
    expect(status().dirty).toBe(true);
    publish();
    expect(deployedFile()?.tools).toEqual({ chat: {} });
    const off = await post({ action: 'chat', enabled: false, roles: [] });
    expect(off.body.chat?.enabled).toBe(false);
    publish();
    expect(deployedFile()?.tools).toBeUndefined();
  });
  it('restricts to the picked roles and shows who has it; clearing restores alle', async () => {
    addRoleToDraft(KEY, admin.id, 'Melder', 'de');
    addRoleToDraft(KEY, admin.id, 'Pruefer', 'de');
    const keys = load(admin).chat.options.map((o) => o.key);
    expect(keys).toHaveLength(2);
    const only = await post({ action: 'chat', enabled: true, roles: [keys[0]] });
    expect(only.body.chat).toMatchObject({ enabled: true, all: false, roles: [keys[0]] });
    const all = await post({ action: 'chat', enabled: true, roles: [] });
    expect(all.body.chat).toMatchObject({ enabled: true, all: true, roles: [] });
  });
  it('refuses a role the project does not have, a wrong shape, and another origin', async () => {
    const unknown = await post({ action: 'chat', enabled: true, roles: ['nobody'] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe('invalid');
    expect((await post({ action: 'chat', enabled: 'yes', roles: [] })).status).toBe(400);
    expect((await post({ action: 'chat', enabled: true, roles: [1] })).status).toBe(400);
    expect((await post({ action: 'chat', enabled: true, roles: [] }, admin, 'cross-site')).status).toBe(403);
    expect(status().dirty).toBe(false);
  });
});

describe('the Kartenebenen are saved into map.layers and map.order (WP-385)', () => {
  const TILES = {
    label: 'Orthofoto',
    kind: 'base',
    source: { type: 'xyz', url: 'https://tiles.example.org/{z}/{x}/{y}.png' },
  };
  const layers = (r: { body: Partial<SettingsPageData> }) => r.body.layers?.layers.map((l) => l.key);

  it('starts with no layer and publishes what was added, changed, ordered and removed', async () => {
    expect(load(admin).layers.layers).toEqual([]);
    const added = await post({ action: 'layers', op: 'add', layer: TILES });
    expect(added.status).toBe(200);
    expect(layers(added)).toEqual(['orthofoto']);
    expect(status().dirty).toBe(true);
    await post({ action: 'layers', op: 'add', layer: { ...TILES, label: 'Flur', kind: 'overlay' } });
    const changed = await post({
      action: 'layers',
      op: 'update',
      key: 'flur',
      patch: { opacity: 0.5, attribution: 'Land' },
    });
    expect(changed.body.layers?.layers[1]).toMatchObject({ opacity: 50, attribution: 'Land', proxied: true });
    const ordered = await post({ action: 'layers', op: 'order', keys: ['flur', 'orthofoto'] });
    expect(layers(ordered)).toEqual(['flur', 'orthofoto']);
    publish();
    expect(Object.keys((deployedFile()?.map as { layers: object }).layers)).toEqual(['orthofoto', 'flur']);
    expect((deployedFile()?.map as { order: string[] }).order).toEqual(['flur', 'orthofoto']);
    const removed = await post({ action: 'layers', op: 'remove', key: 'flur' });
    expect(layers(removed)).toEqual(['orthofoto']);
  });
  it('refuses a wrong form with the check in both languages, an unknown layer, and a wrong body', async () => {
    const bad = await post({
      action: 'layers',
      op: 'add',
      layer: { ...TILES, source: { type: 'xyz', url: 'https://x.org/t.png' } },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('layer_invalid');
    expect((bad.body.message as { de: string }).de).toContain('Platzhalter');
    expect((await post({ action: 'layers', op: 'remove', key: 'nope' })).status).toBe(400);
    expect((await post({ action: 'layers', op: 'add', layer: { label: 1 } })).status).toBe(400);
    expect((await post({ action: 'layers', op: 'spin' })).status).toBe(400);
    expect((await post({ action: 'layers', op: 'order', keys: [] }, outsider)).status).toBe(403);
  });
});

describe('the Vorlage section (WP-448)', () => {
  it('shows the template and its version, with no inputs for a template that offers none', () => {
    const t = load(admin).template;
    expect(t).toMatchObject({ key: 'leer', inputs: [] });
    expect(t.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('refuses an input the template does not declare, and a malformed call, without touching the draft', async () => {
    expect((await post({ action: 'template_inputs', values: { gibt_es_nicht: 1 } })).status).toBe(400);
    expect((await post({ action: 'template_inputs', values: [1] })).status).toBe(400);
    expect(status().dirty).toBe(false);
  });
});
