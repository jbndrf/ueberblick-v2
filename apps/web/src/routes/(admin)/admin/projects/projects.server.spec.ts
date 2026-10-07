import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@ueberblick/server';
import type * as List from './+page.server';
import type * as Create from './new/+page.server';
import type * as Api from '../../../api/admin/projects/+server';

// WP-323: the Projekte page's load, "Projekt erstellen"'s load and the list API, over the REAL runtime (as the shell spec does).
const dir = mkdtempSync(join(tmpdir(), 'ub-admin-projects-'));
let list: typeof List;
let create: typeof Create;
let api: typeof Api;
let stop: () => void = () => undefined;
let admin: Principal;
let other: Principal;
let participant: Principal;

const url = new URL('http://localhost/admin/projects');
const loadList = (principal: Principal | null) =>
  (list.load as (e: unknown) => unknown)({ locals: { admin: principal }, url }) as {
    projects: { name: string; key: string; description: string; published: boolean }[];
  };
const thrown = async (f: () => unknown): Promise<{ status?: number; location?: string }> => {
  try {
    await f();
  } catch (e) {
    return e as { status?: number; location?: string };
  }
  return {};
};

beforeAll(async () => {
  process.env['PUBLIC_URL'] = 'http://localhost:3000';
  process.env['DATA_DIR'] = dir;
  process.env['TIMERS_INTERVAL_S'] = '0';
  const { runtime } = await import('../../../../lib/server/runtime');
  list = await import('./+page.server');
  create = await import('./new/+page.server');
  api = await import('../../../api/admin/projects/+server');
  const rt = runtime();
  stop = () => rt.stop();
  const a = await rt.auth.createAdmin('a@example.org', 'correct horse battery');
  const b = await rt.auth.createAdmin('b@example.org', 'correct horse battery');
  admin = { kind: 'admin', id: a, projectId: null, roles: [] };
  other = { kind: 'admin', id: b, projectId: null, roles: [] };
  participant = { kind: 'participant', id: 'pp', projectId: 'x', roles: [] };
});

afterAll(() => {
  stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('Projekt erstellen', () => {
  it('the template select starts with "Leeres Projekt" and defaults to it', async () => {
    const data = (await (create.load as (e: unknown) => unknown)({ locals: { admin: admin }, url })) as {
      templates: { key: string; label: { de: string } }[];
      defaultTemplate: string;
    };
    expect(data.templates[0]?.label.de).toBe('Leeres Projekt');
    expect(data.defaultTemplate).toBe('leer@1');
  });

  it('is guarded like the layout: sign-in redirect, 303 for a participant (no admin session, WP-705)', async () => {
    const load = (principal: Principal | null) =>
      (create.load as (e: unknown) => unknown)({
        locals: { admin: principal },
        url: new URL('http://localhost/admin/projects/new'),
      });
    expect((await thrown(() => load(null))).status).toBe(303);
    expect((await thrown(() => load(participant))).status).toBe(303);
  });
});

describe('Projekte list', () => {
  beforeAll(async () => {
    // a project made as the API does (WP-309): the list shows it for its creator only
    const { runtime } = await import('../../../../lib/server/runtime');
    const rt = runtime();
    const { createProjectFromTemplate } = await import('@ueberblick/server');
    createProjectFromTemplate(
      rt.control,
      rt.projectDb,
      { name: 'Baumkataster Nord', description: 'Norden', template: 'leer@1' },
      admin.id,
      rt.clock,
    );
  });

  it("lists the admin's own projects, unpublished; another admin sees none", () => {
    const mine = loadList(admin).projects;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      name: 'Baumkataster Nord',
      key: 'baumkataster_nord',
      description: 'Norden',
      published: false,
    });
    expect(loadList(other).projects).toEqual([]);
  });

  it('is guarded like the layout: sign-in redirect, 303 for a participant (no admin session, WP-705)', async () => {
    expect((await thrown(() => loadList(null))).location).toBe('/admin/login?redirectTo=%2Fadmin%2Fprojects');
    expect((await thrown(() => loadList(participant))).status).toBe(303);
  });

  it('GET /api/admin/projects answers the same list (E-1)', async () => {
    const get = (principal: Principal | null) =>
      (api.GET as (e: unknown) => Response)({ locals: { admin: principal } });
    const ok = get(admin);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual([
      expect.objectContaining({ key: 'baumkataster_nord', template: null, published: false }),
    ]);
    expect(get(null).status).toBe(401);
    expect(get(participant).status).toBe(403);
  });
});
