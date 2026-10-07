import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Principal } from '@ueberblick/server';
import { embedGoldenSource } from '@ueberblick/core/testing';
import { startFilter, toolAvailabilityFor, TemplateFileSchema, type TemplateFile } from '@ueberblick/core';
import { defaultSelection } from '@ueberblick/core/registry';
import { hydrate } from '@ueberblick/core/hydrate';
import type { FiltersData } from '../../../../../../lib/admin/settings/presets-types';
import type { SettingsPageData } from '../../../../../../lib/admin/settings/types';
import { presetsOf } from '../../../../../../lib/participant/sheets/filter/filter-views';

// WP-386: the Erststart, Cluster and Filter & Felder saves over the REAL runtime. Each one goes into the draft; after a
// publish the deployed config (what every participant's bootstrap carries) reads the change with the shared helpers.
const dir = mkdtempSync(join(tmpdir(), 'ub-admin-settings-start-'));
let stop: () => void = () => undefined;
let publish: () => void;
let deployedFile: () => TemplateFile;
let seed: (add: Record<string, unknown>) => void;
let draftOverlay: () => string;
let admin: Principal;
let outsider: Principal;
let KEY = 'musterstadt';
let testNo = 0;

const url = () => new URL(`http://localhost/admin/projects/${KEY}/settings`);
const call = (principal: Principal | null, body?: unknown, method = 'POST') => ({
  locals: { admin: principal },
  params: { project: KEY, projectId: KEY },
  url: url(),
  cookies: { get: () => undefined },
  request: new Request(url(), {
    method,
    headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }),
});
const load = (principal: Principal | null): SettingsPageData =>
  (page.load as (e: unknown) => SettingsPageData)(call(principal));
const post = async (body: unknown, principal: Principal | null = admin) => {
  const r = await settings.POST(call(principal, body) as never);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> & Partial<SettingsPageData> };
};
const filters = async (principal: Principal | null = admin) => {
  const r = await filtersRoute.GET(call(principal, undefined, 'GET') as never);
  return { status: r.status, body: (await r.json()) as Partial<FiltersData> & Record<string, unknown> };
};

process.env['PUBLIC_URL'] = 'http://localhost:3000';
process.env['DATA_DIR'] = dir;
process.env['TIMERS_INTERVAL_S'] = '0';
const { runtime } = await import('../../../../../../lib/server/runtime');
const { createDraftStore, createProjectFromTemplate, deploy, ensureDraft, publishTemplate } =
  await import('@ueberblick/server');
const { parse, stringify } = await import('yaml');
const page = await import('./+page.server');
const settings = await import('./+server');
const filtersRoute = await import('./filters/+server');

/** The demo template offers `views` and `cluster` (WP-671); these specs start from a project that declares neither. */
const withoutDemoTools = (src: string): string => {
  const file = parse(src) as {
    tools?: Record<string, unknown>;
    roles?: Record<string, { app?: { tools?: Record<string, unknown> } }>;
  };
  for (const t of ['views', 'cluster']) {
    delete file.tools?.[t];
    for (const role of Object.values(file.roles ?? {})) delete role.app?.tools?.[t];
  }
  return stringify(file);
};
const goldenTemplate = (): TemplateFile =>
  TemplateFileSchema.parse(
    parse(
      withoutDemoTools(
        embedGoldenSource(
          readFileSync(
            fileURLToPath(
              new URL(
                '../../../../../../../../../fixtures/golden/templates/baumkataster/1.1.0.yaml',
                import.meta.url,
              ),
            ),
            'utf8',
          ),
        ),
      ),
    ),
  );
const LAYERS = {
  luftbild: {
    label: 'Luftbild',
    kind: 'base',
    source: { type: 'xyz', url: 'https://t.example/{z}/{x}/{y}.png' },
  },
  flur: {
    label: 'Flurkarte',
    kind: 'overlay',
    source: { type: 'xyz', url: 'https://f.example/{z}/{x}/{y}.png' },
  },
};

beforeAll(async () => {
  const rt = runtime();
  stop = () => rt.stop();
  const published = publishTemplate(rt.control, goldenTemplate(), rt.clock);
  if (!published.ok) throw new Error(JSON.stringify(published));
  draftOverlay = () => createDraftStore(rt.projectDb(KEY)).get()?.overlay ?? '';
  publish = () => {
    const done = deploy(rt.projectDb(KEY), parse(draftOverlay()), admin.id, {
      clock: rt.clock,
      templates: rt.templates,
    });
    if (!done.ok) throw new Error(JSON.stringify(done.problems));
  };
  deployedFile = () => {
    const file = rt.services.deployed(KEY)?.config.file;
    if (file === undefined) throw new Error('nothing deployed');
    return file;
  };
  const a = await rt.auth.createAdmin('start-a@example.org', 'correct horse battery');
  const b = await rt.auth.createAdmin('start-b@example.org', 'correct horse battery');
  admin = { kind: 'admin', id: a, projectId: null, roles: [] };
  outsider = { kind: 'admin', id: b, projectId: null, roles: [] };
});

beforeEach(() => {
  const rt = runtime();
  testNo += 1;
  KEY = createProjectFromTemplate(
    rt.control,
    rt.projectDb,
    { name: `Baumstadt ${testNo}`, description: '', template: 'baumkataster@1' },
    admin.id,
    rt.clock,
  ).key;
  publish();
  // Seeding adds what the Kartenebenen page will (layers) to the draft.
  seed = (add) => {
    const ensured = ensureDraft(rt.projectDb(KEY), rt.clock, admin.id);
    if (!ensured.ok) throw new Error('no draft');
    const overlay = parse(ensured.draft.overlay) as { add?: Record<string, unknown> };
    overlay.add = { ...overlay.add, ...add };
    const saved = createDraftStore(rt.projectDb(KEY)).putIf(
      ensured.draft.revision,
      stringify(overlay),
      admin.id,
      rt.clock.now(),
    );
    if (!saved.ok) throw new Error('seed refused');
  };
});

afterAll(() => {
  stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('the load carries what the three sections show', () => {
  it('lists the layers, and the tools per role: not declared, so no role has them', () => {
    const data = load(admin);
    expect(data.startup.layers).toEqual([{ key: 'osm', label: 'Straßenkarte', kind: 'base', on: true }]);
    expect(data.cluster.declared).toBe(false);
    expect(data.cluster.roles.map((r) => [r.key, r.label, r.state])).toEqual([
      ['kontrolle', 'Baumkontrolle', 'none'],
      ['bauhof', 'Bauhof', 'none'],
      ['verwaltung', 'Verwaltung', 'none'],
    ]);
  });
});

describe('Erststart: the layers on at start reach the participant', () => {
  it('saves into the draft; after publishing, the default selection is the chosen base and overlays', async () => {
    seed({ 'map.layers.luftbild': LAYERS.luftbild, 'map.layers.flur': LAYERS.flur });
    expect(load(admin).startup.layers.map((l) => l.key)).toEqual(['osm', 'luftbild', 'flur']);
    const r = await post({ action: 'startup', base: 'luftbild', overlays: ['flur'], types: {} });
    expect(r.status).toBe(200);
    expect(r.body.startup?.layers.filter((l) => l.on).map((l) => l.key)).toEqual(['luftbild', 'flur']);
    publish();
    const map = deployedFile().map;
    if (map === undefined) throw new Error('no map');
    expect(defaultSelection(map)).toEqual({ base: 'luftbild', overlays: ['flur'] });
  });

  it('refuses a layer of the wrong kind or an unknown one, and a body of the wrong shape', async () => {
    seed({ 'map.layers.flur': LAYERS.flur });
    expect((await post({ action: 'startup', base: 'flur', overlays: [], types: {} })).body.error).toBe(
      'invalid',
    );
    expect(
      (await post({ action: 'startup', base: null, overlays: ['gibt_es_nicht'], types: {} })).status,
    ).toBe(400);
    expect((await post({ action: 'startup', base: 7, overlays: [], types: {} })).status).toBe(400);
    expect((await post({ action: 'startup', base: null })).status).toBe(400);
  });
});

describe('Erststart: the Objektarten on at start reach the deployed config (WP-397)', () => {
  it('saves into the draft; after publishing the config carries on_at_start and values_at_start, and the start filter follows', async () => {
    expect(load(admin).startup.types.map((t) => [t.key, t.on])).toEqual([
      ['flaeche', true],
      ['baum', true],
    ]);
    const r = await post({
      action: 'startup',
      base: null,
      overlays: [],
      types: { flaeche: { on: false, values: null }, baum: { on: true, values: ['erfasst', 'massnahme'] } },
    });
    expect(r.status).toBe(200);
    expect(r.body.startup?.types.map((t) => [t.key, t.on])).toEqual([
      ['flaeche', false],
      ['baum', true],
    ]);
    publish();
    const types = deployedFile().types;
    expect(types?.['flaeche']?.on_at_start).toBe(false);
    expect(types?.['baum']?.values_at_start).toEqual(['erfasst', 'massnahme']);
    const start = startFilter(deployedFile());
    expect([...start.hiddenTypes]).toEqual(['flaeche']);
    expect([...(start.hiddenValues.get('baum' as never) ?? [])]).toEqual(['kontrolliert', 'erledigt']);
  });

  it('refuses an unknown value, and a body of the wrong shape', async () => {
    const bad = { action: 'startup', base: null, overlays: [] };
    expect((await post({ ...bad, types: { baum: { on: true, values: ['zz'] } } })).body.error).toBe(
      'invalid',
    );
    expect((await post({ ...bad, types: { baum: { on: 'yes', values: null } } })).status).toBe(400);
    expect((await post({ ...bad, types: [] })).status).toBe(400);
  });
});

describe('Cluster: "Beim Start aktiv" per role', () => {
  it('on for all roles: after publishing every role has the tool active; off: offered', async () => {
    const on = await post({ action: 'cluster', roles: null, on: true });
    expect(on.status).toBe(200);
    expect(on.body.cluster?.roles.every((r) => r.state === 'active')).toBe(true);
    publish();
    for (const role of ['kontrolle', 'bauhof', 'verwaltung'])
      expect(toolAvailabilityFor(deployedFile(), [role], 'cluster')).toBe('active');
    await post({ action: 'cluster', roles: null, on: false });
    publish();
    expect(toolAvailabilityFor(deployedFile(), ['bauhof'], 'cluster')).toBe('offered');
  });

  it('one role only', async () => {
    await post({ action: 'cluster', roles: ['bauhof'], on: true });
    publish();
    expect(toolAvailabilityFor(deployedFile(), ['bauhof'], 'cluster')).toBe('active');
    expect(toolAvailabilityFor(deployedFile(), ['kontrolle'], 'cluster')).toBeUndefined();
  });

  it('refuses an unknown role, a body of the wrong shape, another admin and no session', async () => {
    const unknown = await post({ action: 'cluster', roles: ['gibt_es_nicht'], on: true });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe('refused');
    expect((await post({ action: 'cluster', roles: null, on: 'yes' })).status).toBe(400);
    expect((await post({ action: 'cluster', roles: null, on: true }, outsider)).status).toBe(403);
    expect((await post({ action: 'cluster', roles: null, on: true }, null)).status).toBe(401);
  });
});

describe('Filter & Felder: the Ansichten tool and the presets', () => {
  it('the tool switch writes tools.views for the roles', async () => {
    await post({ action: 'field_filters', roles: null, on: true });
    publish();
    expect(toolAvailabilityFor(deployedFile(), ['kontrolle'], 'views')).toBe('active');
  });

  it('a preset saved for two roles is in the deployed file and in the participant list of exactly those roles', async () => {
    const saved = await post({
      action: 'preset_save',
      preset: {
        name: 'Kontrollierte Bäume',
        roles: ['kontrolle', 'bauhof'],
        filters: { baum: "self.stage == 'kontrolliert'" },
      },
    });
    expect(saved.status).toBe(200);
    publish();
    const file = deployedFile();
    expect(presetsOf(file, 'kontrolle', 'de')).toEqual([
      { key: 'kontrollierte_baeume', label: 'Kontrollierte Bäume' },
    ]);
    expect(presetsOf(file, 'bauhof', 'de')).toHaveLength(1);
    expect(presetsOf(file, 'verwaltung', 'de')).toEqual([]);
  });

  it('the section data: roles, presets with their condition count, and a config the builder can hydrate', async () => {
    await post({
      action: 'preset_save',
      preset: {
        name: 'Kontrollierte Bäume',
        roles: ['kontrolle'],
        filters: { baum: "self.stage == 'kontrolliert'" },
      },
    });
    const r = await filters();
    expect(r.status).toBe(200);
    expect(r.body.roles?.map((x) => x.key)).toEqual(['kontrolle', 'bauhof', 'verwaltung']);
    expect(r.body.presets).toMatchObject([
      { key: 'kontrollierte_baeume', roles: ['kontrolle'], conditions: 1 },
    ]);
    expect(Object.keys(hydrate(r.body.config as never).file.types ?? {})).toContain('baum');
  });

  it('edit and delete: the preset follows its roles and goes away from all of them', async () => {
    await post({
      action: 'preset_save',
      preset: { name: 'A', roles: ['kontrolle', 'bauhof'], filters: { baum: 'true' } },
    });
    const edited = await post({
      action: 'preset_save',
      preset: {
        name: 'A neu',
        roles: ['bauhof'],
        filters: { baum: 'true' },
        key: 'a',
        was: ['kontrolle', 'bauhof'],
      },
    });
    expect(edited.status).toBe(200);
    const list = (await filters()).body.presets;
    expect(list).toMatchObject([{ key: 'a', label: 'A neu', roles: ['bauhof'] }]);
    expect((await post({ action: 'preset_delete', ref: { key: 'a', roles: ['bauhof'] } })).status).toBe(200);
    expect((await filters()).body.presets).toEqual([]);
  });

  it('refuses a preset without a name or without a role, in both languages', async () => {
    const noName = await post({
      action: 'preset_save',
      preset: { name: ' ', roles: ['kontrolle'], filters: {} },
    });
    expect(noName.status).toBe(400);
    expect(noName.body.message).toEqual({ de: 'Name fehlt', en: 'Name missing' });
    const noRole = await post({ action: 'preset_save', preset: { name: 'A', roles: [], filters: {} } });
    expect(noRole.body.error).toBe('roles_missing');
    expect(
      (
        await post({
          action: 'preset_save',
          preset: { name: 'A', roles: ['kontrolle'], filters: { baum: 3 } },
        })
      ).status,
    ).toBe(400);
  });

  it('the section data is guarded like the admin area, and says so when the draft does not compile', async () => {
    expect((await filters(outsider)).status).toBe(403);
    expect((await filters(null)).status).toBe(401);
    // a preset for a type the file does not have: the draft is saved (the Doc model allows it) but does not compile
    await post({
      action: 'preset_save',
      preset: { name: 'Kaputt', roles: ['kontrolle'], filters: { gibt_es_nicht: 'true' } },
    });
    const r = await filters();
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('problems');
    expect((r.body.message as { de: string }).de).toContain('Entwurf');
  });
});
