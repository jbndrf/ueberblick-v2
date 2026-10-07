import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Principal } from '@ueberblick/server';
import type { RelationsPageData } from '../../../../../../lib/admin/relations/types';

// WP-365: the Beziehungen page's server side over the REAL runtime: the load and the draft edits (Doc ops).
const dir = mkdtempSync(join(tmpdir(), 'ub-admin-relations-'));
let stop: () => void = () => undefined;
let status: () => { dirty: boolean };
let overlayOf: () => string;
let publish: () => void;
let admin: Principal;
let outsider: Principal;
let KEY = 'musterstadt';
let testNo = 0;

const url = () => new URL(`http://localhost/admin/projects/${KEY}/relations`);
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
const load = (principal: Principal | null): RelationsPageData =>
  (page.load as (e: unknown) => RelationsPageData)(call(principal));
interface Answer {
  readonly id?: string;
  readonly error?: string;
  readonly message?: { readonly de: string; readonly en: string };
  readonly uses?: readonly { path: string; message: string }[];
  readonly child?: string;
  readonly refKey?: string;
}
const post = async (body: unknown, principal: Principal | null = admin, site?: string) => {
  const r = await relations.POST(call(principal, body, site) as never);
  return { status: r.status, body: (await r.json()) as Answer };
};
const NEW = {
  action: 'create',
  name: 'Inspektionen',
  parent: 'flaeche',
  child: 'massnahme',
  cardinality: 'many',
};

process.env['PUBLIC_URL'] = 'http://localhost:3000';
process.env['DATA_DIR'] = dir;
process.env['TIMERS_INTERVAL_S'] = '0';
const { runtime } = await import('../../../../../../lib/server/runtime');
const { draftStatus, createDraftStore, createProjectFromTemplate, deploy } =
  await import('@ueberblick/server');
const { parse } = await import('yaml');
const { openProject } = await import('@ueberblick/builder');
const { draftSources, ensureDraft } = await import('@ueberblick/server');
const page = await import('./+page.server');
const relations = await import('./+server');

beforeAll(async () => {
  const rt = runtime();
  stop = () => rt.stop();
  status = () => draftStatus(rt.projectDb(KEY), { clock: rt.clock, templates: rt.templates });
  publish = () => {
    const done = deploy(rt.projectDb(KEY), parse(overlayOf()), admin.id, {
      clock: rt.clock,
      templates: rt.templates,
    });
    if (!done.ok) throw new Error(JSON.stringify(done.problems));
  };
  overlayOf = () => createDraftStore(rt.projectDb(KEY)).get()?.overlay ?? '';
  const a = await rt.auth.createAdmin('a@example.org', 'correct horse battery');
  const b = await rt.auth.createAdmin('b@example.org', 'correct horse battery');
  admin = { kind: 'admin', id: a, projectId: null, roles: [] };
  outsider = { kind: 'admin', id: b, projectId: null, roles: [] };
});

/** Two feature types in the draft (the built-in empty template has none): the page needs something to relate. */
function seedTypes(): void {
  const rt = runtime();
  const ensured = ensureDraft(rt.projectDb(KEY), rt.clock, admin.id);
  const sources = ensured.ok ? draftSources(ensured.draft, rt.templates) : null;
  if (!ensured.ok || !sources) throw new Error('no draft');
  let doc = openProject(sources.templateSrc, sources.overlaySrc);
  for (const [key, label] of [
    ['flaeche', 'Fläche'],
    ['massnahme', 'Maßnahme'],
  ] as const)
    doc = doc.apply({
      kind: 'add',
      path: `types.${key}`,
      value: { label: { de: label }, properties: {} },
    }).doc;
  const put = createDraftStore(rt.projectDb(KEY)).putIf(
    ensured.draft.revision,
    doc.save().overlaySrc,
    admin.id,
    rt.clock.now(),
  );
  if (!put.ok) throw new Error('seed failed');
}

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
  seedTypes();
});

afterAll(() => {
  stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('the load', () => {
  it('lists the feature types to pick from, and no relation in a project without one', () => {
    const data = load(admin);
    expect(data.relations).toEqual([]);
    expect(data.types.map((t) => t.key)).toContain('flaeche');
  });

  it('is guarded like the admin area', () => {
    expect(() => load(null)).toThrow();
    expect(() => load(outsider)).toThrow();
  });
});

describe('create, edit and delete are Doc ops on the draft', () => {
  it('create writes the reference and the inverse list into the draft overlay; publishing makes it live', async () => {
    const r = await post(NEW);
    expect(r).toMatchObject({ status: 201, body: { id: 'flaeche.inspektionen' } });
    expect(overlayOf()).toContain('inverse_of: massnahme.flaeche');
    expect(status().dirty).toBe(true);
    expect(load(admin).relations).toEqual([
      expect.objectContaining({
        id: 'flaeche.inspektionen',
        label: 'Inspektionen',
        parentLabel: 'Fläche',
        childLabel: 'Maßnahme',
        cardinality: 'many',
        source: 'overlay',
      }),
    ]);
    publish();
    expect(status().dirty).toBe(false);
    expect(load(admin).relations).toHaveLength(1);
  });

  it('edit changes the multiplicity and the name in place', async () => {
    await post(NEW);
    const r = await post({
      action: 'update',
      id: 'flaeche.inspektionen',
      name: 'Kontrollen',
      cardinality: 'one',
    });
    expect(r.status).toBe(200);
    expect(load(admin).relations[0]).toMatchObject({ label: 'Kontrollen', cardinality: 'one' });
  });

  it('refuses in both languages: an empty name, the same type, an unknown relation, a foreign admin, another origin', async () => {
    const empty = await post({ ...NEW, name: ' ' });
    expect(empty.status).toBe(400);
    expect(empty.body.message).toEqual({ de: 'Bitte einen Namen eingeben', en: 'Please enter a name' });
    expect((await post({ ...NEW, child: 'flaeche' })).status).toBe(400);
    expect((await post({ action: 'update', id: 'a.b', name: 'x' })).status).toBe(400);
    expect((await post(NEW, outsider)).status).toBe(403);
    expect((await post(NEW, admin, 'cross-site')).status).toBe(403);
  });

  it('"uses" changes nothing; "delete" removes the relation and its reference', async () => {
    await post(NEW);
    const before = overlayOf();
    const preview = await post({ action: 'uses', id: 'flaeche.inspektionen' });
    expect(preview).toMatchObject({ status: 200, body: { child: 'massnahme', refKey: 'flaeche', uses: [] } });
    expect(overlayOf()).toBe(before);
    expect((await post({ action: 'delete', id: 'flaeche.inspektionen' })).status).toBe(200);
    expect(load(admin).relations).toEqual([]);
    expect((await post({ action: 'delete', id: 'flaeche.inspektionen' })).status).toBe(400);
  });
});

describe('the options are tasks and steps of the draft (WP-371, owner A2)', () => {
  it('the load offers the registry choices', () => {
    expect(load(admin).choices).toEqual({
      attachments: ['enforced', 'optional'],
      onDelete: ['cascade', 'nullify', 'block'],
      geometries: ['inherit', 'draw', 'none'],
    });
    expect(load(admin).types.map((t) => t.hasGeometry)).toEqual([false, false]);
  });

  it("a new relation has v3's defaults, written as the child's creating task, and publishes", async () => {
    expect((await post(NEW)).status).toBe(201);
    expect(load(admin).relations[0]).toMatchObject({ attachment: 'enforced', onDelete: 'nullify' });
    expect(overlayOf()).toContain('rel_7_flaeche_inspektionen_create');
    publish();
    expect(status().dirty).toBe(false);
  });

  it("mitlöschen and blockieren add the parent's delete task; they publish and read back", async () => {
    expect((await post({ ...NEW, attachment: 'optional', onDelete: 'cascade' })).status).toBe(201);
    expect(load(admin).relations[0]).toMatchObject({ attachment: 'optional', onDelete: 'cascade' });
    expect(overlayOf()).toContain('of: self.inspektionen');
    publish();
    const r = await post({ action: 'update', id: 'flaeche.inspektionen', onDelete: 'block' });
    expect(r.status).toBe(200);
    expect(load(admin).relations[0]?.onDelete).toBe('block');
    expect(overlayOf()).toContain('self.inspektionen.size() == 0');
  });

  it('refuses an option that is not in the registry', async () => {
    expect((await post({ ...NEW, onDelete: 'explode' })).status).toBe(400);
    expect((await post({ ...NEW, attachment: 'maybe' })).status).toBe(400);
  });

  it('deleting a draft-only relation takes the generated entries with it', async () => {
    const before = overlayOf();
    await post({ ...NEW, onDelete: 'cascade' });
    expect((await post({ action: 'delete', id: 'flaeche.inspektionen' })).status).toBe(200);
    expect(overlayOf()).toBe(before);
  });
});

/** The child type gains a primary geometry in the draft (as the builder's Felder would). */
function giveGeometry(type: string): void {
  const rt = runtime();
  const ensured = ensureDraft(rt.projectDb(KEY), rt.clock, admin.id);
  const sources = ensured.ok ? draftSources(ensured.draft, rt.templates) : null;
  if (!ensured.ok || !sources) throw new Error('no draft');
  let doc = openProject(sources.templateSrc, sources.overlaySrc);
  doc = doc.apply({
    kind: 'add',
    path: `types.${type}.properties.ort`,
    value: { type: 'geometry', geometry_type: 'point' },
  }).doc;
  doc = doc.apply({ kind: 'add', path: `types.${type}.geometry`, value: 'ort' }).doc;
  const put = createDraftStore(rt.projectDb(KEY)).putIf(
    ensured.draft.revision,
    doc.save().overlaySrc,
    admin.id,
    rt.clock.now(),
  );
  if (!put.ok) throw new Error('geometry failed');
}

describe('Geometrie beim Erstellen (WP-396)', () => {
  it('a new relation to a child without geometry defaults to übernehmen (inherit_position) and publishes', async () => {
    expect((await post(NEW)).status).toBe(201);
    expect(load(admin).relations[0]).toMatchObject({ geometry: 'inherit', geometryProblem: false });
    expect(overlayOf()).toContain('inherit_position: true');
    publish();
    expect(status().dirty).toBe(false);
  });

  it('keine writes no inherit_position and reads back; the mode can change back', async () => {
    expect((await post({ ...NEW, geometry: 'none' })).status).toBe(201);
    expect(load(admin).relations[0]?.geometry).toBe('none');
    expect(overlayOf()).not.toContain('inherit_position');
    expect((await post({ action: 'update', id: 'flaeche.inspektionen', geometry: 'inherit' })).status).toBe(
      200,
    );
    expect(load(admin).relations[0]?.geometry).toBe('inherit');
    publish();
  });

  it('a child that gains a geometry later shows the engine problem, and zeichnen resolves it', async () => {
    expect((await post(NEW)).status).toBe(201);
    giveGeometry('massnahme');
    expect(load(admin).types.find((t) => t.key === 'massnahme')?.hasGeometry).toBe(true);
    expect(load(admin).relations[0]).toMatchObject({ geometry: 'inherit', geometryProblem: true });
    expect((await post({ action: 'update', id: 'flaeche.inspektionen', geometry: 'draw' })).status).toBe(200);
    expect(load(admin).relations[0]).toMatchObject({ geometry: 'draw', geometryProblem: false });
    publish();
  });

  it('refuses a mode that is not in the registry', async () => {
    expect((await post({ ...NEW, geometry: 'teleport' })).status).toBe(400);
  });
});
