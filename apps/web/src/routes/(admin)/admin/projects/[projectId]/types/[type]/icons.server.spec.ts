import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '@ueberblick/server';
import type { IconCall, IconsState } from '../../../../../../../lib/admin/icons/types';

// The page module reaches the runtime through `$lib` (draft-source.server), which vitest does not resolve.
vi.mock('$lib/server/runtime', () => import('../../../../../../../lib/server/runtime'));

// WP-356: the Icons dialog's server side over the REAL runtime: the load and the draft edits (Doc ops), through the
// data page's own load and form action.
const dir = mkdtempSync(join(tmpdir(), 'ub-admin-icons-'));
let stop: () => void = () => undefined;
let status: () => { dirty: boolean };
let overlayOf: () => string;
let admin: Principal;
let outsider: Principal;
let KEY = 'musterstadt';
let testNo = 0;

const url = () => new URL(`http://localhost/admin/projects/${KEY}/types/baum`);
const event = (principal: Principal | null, body?: unknown) => ({
  locals: { admin: principal },
  params: { project: KEY, projectId: KEY, type: 'baum' },
  url: url(),
  cookies: { get: () => undefined },
  parent: () => Promise.resolve({ types: [{ key: 'baum', label: 'Baum' }], locale: 'de' }),
  request: new Request(url(), {
    method: 'POST',
    ...(body === undefined ? {} : { body: formOf(body) }),
  }),
});
const formOf = (call: unknown): FormData => {
  const f = new FormData();
  f.set('call', typeof call === 'string' ? call : JSON.stringify(call));
  return f;
};

interface Answer {
  readonly state?: IconsState;
  readonly code?: string;
  readonly message?: { de: string; en: string };
  readonly error?: string;
}
const act = async (call: IconCall | string, principal: Principal | null = admin) => {
  const r = (await (page.actions.icons as (e: unknown) => Promise<unknown>)(event(principal, call))) as {
    status?: number;
    data?: Answer;
  } & Answer;
  // a success is the plain data, a refusal is `fail()`: { status, data }
  return r.data === undefined ? { status: 200, body: r as Answer } : { status: r.status ?? 0, body: r.data };
};
const load = async (principal: Principal | null = admin) =>
  (await (page.load as (e: unknown) => Promise<{ icons: IconsState | null }>)(event(principal))).icons;

process.env['PUBLIC_URL'] = 'http://localhost:3000';
process.env['DATA_DIR'] = dir;
process.env['TIMERS_INTERVAL_S'] = '0';
const { runtime } = await import('../../../../../../../lib/server/runtime');
const { draftStatus, createDraftStore, createProjectFromTemplate, ensureDraft, draftSources } =
  await import('@ueberblick/server');
const { openProject } = await import('@ueberblick/builder');
const page = await import('./+page.server');

beforeAll(async () => {
  const rt = runtime();
  stop = () => rt.stop();
  status = () => draftStatus(rt.projectDb(KEY), { clock: rt.clock, templates: rt.templates });
  overlayOf = () => createDraftStore(rt.projectDb(KEY)).get()?.overlay ?? '';
  const a = await rt.auth.createAdmin('a@example.org', 'correct horse battery');
  const b = await rt.auth.createAdmin('b@example.org', 'correct horse battery');
  admin = { kind: 'admin', id: a, projectId: null, roles: [] };
  outsider = { kind: 'admin', id: b, projectId: null, roles: [] };
});

/** A type "baum" in the draft with a stage property, a second select and a multiselect (the empty template has none). */
function seedType(): void {
  const rt = runtime();
  const ensured = ensureDraft(rt.projectDb(KEY), rt.clock, admin.id);
  const sources = ensured.ok ? draftSources(ensured.draft, rt.templates) : null;
  if (!ensured.ok || !sources) throw new Error('no draft');
  const doc = openProject(sources.templateSrc, sources.overlaySrc).apply({
    kind: 'add',
    path: 'types.baum',
    value: {
      label: { de: 'Baum' },
      properties: {
        status: { type: 'select', label: { de: 'Status' }, options: { neu: 'Neu', fertig: 'Fertig' } },
        art: { type: 'select', options: { eiche: 'Eiche', buche: 'Buche' } },
        tags: { type: 'multiselect', options: { a: 'A', b: 'B' } },
        name: { type: 'text' },
      },
      process: { property: 'status', start: 'neu', end: ['fertig'] },
    },
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
  seedType();
});

afterAll(() => {
  stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('the load', () => {
  it('gives the look of the type from the draft, with the select properties (no multiselect, no text)', async () => {
    const icons = await load();
    expect(icons?.classify).toBeNull();
    expect(icons?.selects.map((s) => s.key)).toEqual(['status', 'art']);
    expect(icons?.stage).toBe('status');
  });

  it('is null for a type the project has not got, and guarded like the admin area', async () => {
    expect(await load()).not.toBeNull();
    await expect(load(null)).rejects.toThrow();
    await expect(load(outsider)).rejects.toThrow();
  });
});

describe('the edits are Doc ops on the draft', () => {
  it('picks the stage property, sets a value icon and the type icon; the YAML and the status show it', async () => {
    expect((await act({ action: 'property', property: 'status' })).body.state?.classify).toEqual({
      property: 'status',
      values: {},
    });
    const set = await act({
      action: 'set_value',
      value: 'neu',
      look: { color: '#112233', icon: { key: 'flag' } },
    });
    expect(set.body.state?.classify?.values['neu']).toEqual({ color: '#112233', icon: { key: 'flag' } });
    const marker = await act({ action: 'set_marker', look: { color: '#445566', icon: { key: 'leaf' } } });
    expect(marker.body.state?.marker).toEqual({ color: '#445566', icon: { key: 'leaf' } });
    const yaml = overlayOf();
    expect(yaml).toContain('classify');
    expect(yaml).toContain('#112233');
    expect(yaml).toContain('marker');
    expect(status().dirty).toBe(true);
    expect((await load())?.classify?.values['neu']?.color).toBe('#112233');
  });

  it('clears: the entry, then "keine" removes classify', async () => {
    await act({ action: 'property', property: 'status' });
    await act({ action: 'set_value', value: 'neu', look: { color: '#112233' } });
    expect((await act({ action: 'clear_value', value: 'neu' })).body.state?.classify?.values).toEqual({});
    expect((await act({ action: 'property', property: null })).body.state?.classify).toBeNull();
    expect((await act({ action: 'clear_marker' })).body.state?.marker).toBeNull();
  });

  it('refuses a multiselect, a text property, bad SVG and a size outside 8 to 128, in both languages', async () => {
    for (const property of ['tags', 'name']) {
      const r = await act({ action: 'property', property });
      expect(r).toMatchObject({ status: 400, body: { code: 'property_invalid' } });
    }
    await act({ action: 'property', property: 'status' });
    const svg = await act({ action: 'set_value', value: 'neu', look: { icon: { svg: '<div/>' } } });
    expect(svg.body.code).toBe('invalid_svg');
    expect(svg.body.message?.de).toContain('Ungültiges SVG');
    expect(svg.body.message?.en).toContain('Invalid SVG');
    const size = await act({
      action: 'set_value',
      value: 'neu',
      look: { icon: { key: 'check', size: 129 } },
    });
    expect(size.body).toMatchObject({ code: 'invalid_size' });
    expect(size.body.message?.de).toContain('8 bis 128');
  });

  it('refuses a malformed call and a visitor without access', async () => {
    expect((await act('not json')).status).toBe(400);
    expect((await act({ action: 'nope' } as never)).status).toBe(400);
    await expect(act({ action: 'clear_marker' }, null)).rejects.toThrow();
    await expect(act({ action: 'clear_marker' }, outsider)).rejects.toThrow();
  });
});
