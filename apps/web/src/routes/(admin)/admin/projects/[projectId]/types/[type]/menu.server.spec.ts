import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '@ueberblick/server';
import type { MenuAnswer, MenuCall } from '../../../../../../../lib/admin/data/menu-types';

// The page module reaches the runtime through `$lib` (draft-source.server), which vitest does not resolve.
vi.mock('$lib/server/runtime', () => import('../../../../../../../lib/server/runtime'));

// WP-419: the ⋮ menu's server side over the REAL runtime: duplicate, import and remove are draft edits (Doc ops), and the
// delete dialog's counts come from the project's own tables.
const dir = mkdtempSync(join(tmpdir(), 'ub-admin-menu-'));
let stop: () => void = () => undefined;
let admin: Principal;
let outsider: Principal;
let KEY = 'a';
let OTHER = 'b';
let testNo = 0;

const url = () => new URL(`http://localhost/admin/projects/${KEY}/types/baum`);
const event = (principal: Principal | null, call: unknown) => ({
  locals: { admin: principal },
  params: { project: KEY, projectId: KEY, type: 'baum' },
  url: url(),
  cookies: { get: () => undefined },
  request: new Request(url(), { method: 'POST', body: formOf(call) }),
});
const formOf = (call: unknown): FormData => {
  const f = new FormData();
  f.set('call', JSON.stringify(call));
  return f;
};
type Done =
  | { readonly ok: true; readonly answer: MenuAnswer }
  | { readonly ok: false; readonly status: number; readonly message: { de: string; en: string } };
const act = async (call: MenuCall, principal: Principal | null = admin): Promise<Done> => {
  const r = (await (page.actions.menu as (e: unknown) => Promise<unknown>)(event(principal, call))) as {
    status?: number;
    data?: { message: { de: string; en: string } };
  } & MenuAnswer;
  return r.data === undefined
    ? { ok: true, answer: r }
    : { ok: false, status: r.status ?? 0, message: r.data.message };
};
const need = (d: Done): MenuAnswer => {
  if (!d.ok) throw new Error(d.message.de);
  return d.answer;
};

process.env['PUBLIC_URL'] = 'http://localhost:3000';
process.env['DATA_DIR'] = dir;
process.env['TIMERS_INTERVAL_S'] = '0';
const { runtime } = await import('../../../../../../../lib/server/runtime');
const { createDraftStore, createProjectFromTemplate, deploy, draftSources, ensureDraft } =
  await import('@ueberblick/server');
const { parse } = await import('yaml');
const { openProject } = await import('@ueberblick/builder');
const page = await import('./+page.server');

beforeAll(async () => {
  const rt = runtime();
  stop = () => rt.stop();
  const a = await rt.auth.createAdmin('a@example.org', 'correct horse battery');
  const b = await rt.auth.createAdmin('b@example.org', 'correct horse battery');
  admin = { kind: 'admin', id: a, projectId: null, roles: [] };
  outsider = { kind: 'admin', id: b, projectId: null, roles: [] };
});

/** A type "baum" with a stage, a task offered on it, a rule that runs it and a view, in the draft of `key`. */
function seed(key: string, create?: string[]): void {
  const rt = runtime();
  const ensured = ensureDraft(rt.projectDb(key), rt.clock, admin.id);
  const sources = ensured.ok ? draftSources(ensured.draft, rt.templates) : null;
  if (!ensured.ok || !sources) throw new Error('no draft');
  let doc = openProject(sources.templateSrc, sources.overlaySrc);
  const add = (path: string, value: unknown): void => {
    doc = doc.apply({ kind: 'add', path: path as never, value }).doc;
  };
  if (create) add('roles.gaertner', { label: { de: 'Gärtner' } });
  add('types.baum', {
    label: { de: 'Baum' },
    properties: {
      status: { type: 'select', options: { neu: 'Neu', fertig: 'Fertig' } },
      name: { type: 'text' },
    },
    process: { property: 'status', start: 'neu', end: ['fertig'] },
    permissions: { see: '$all', ...(create ? { create } : {}) },
  });
  add('tasks.pruefen', {
    label: { de: 'Prüfen' },
    on: 'baum',
    then: [{ set: { status: "'fertig'" } }],
  });
  add('views.alle', { label: { de: 'Alle' }, source: { type: 'baum' } });
  const put = createDraftStore(rt.projectDb(key)).putIf(
    ensured.draft.revision,
    doc.save().overlaySrc,
    admin.id,
    rt.clock.now(),
  );
  if (!put.ok) throw new Error('seed failed');
}

const create = (name: string): string =>
  createProjectFromTemplate(
    runtime().control,
    runtime().projectDb,
    { name, description: '', template: 'leer@1' },
    admin.id,
    runtime().clock,
  ).key;

const draftFile = (key: string) => {
  const rt = runtime();
  const d = createDraftStore(rt.projectDb(key)).get();
  const s = d && draftSources(d, rt.templates);
  if (!s) throw new Error('no draft');
  return openProject(s.templateSrc, s.overlaySrc).effective();
};

beforeEach(() => {
  testNo += 1;
  KEY = create(`Menü ${testNo}`);
  seed(KEY);
});

afterAll(() => {
  stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('Duplizieren', () => {
  it('adds the copy with its task and view to the draft and answers with its key', async () => {
    const a = need(await act({ action: 'duplicate' }));
    expect(a.kind === 'copy' && a.copy.key).toBe('baum_kopie');
    const file = draftFile(KEY);
    expect(file.types?.['baum_kopie']?.label).toEqual({ de: 'Baum (Kopie)' });
    expect(file.tasks?.['pruefen_kopie']?.on).toBe('baum_kopie');
    expect(file.views?.['alle_kopie']?.source.type).toBe('baum_kopie');
    expect(file.types?.['baum']).toBeDefined();
  });
});

describe('Objektart löschen', () => {
  it('counts what goes with the type (from the draft and the project tables)', async () => {
    const a = need(await act({ action: 'counts' }));
    expect(a.kind === 'counts' && a.counts).toEqual({
      stages: 2,
      tasks: 1,
      rules: 0,
      views: 1,
      objects: 0,
      values: 0,
    });
  });

  it('removes the type and what belongs to it from the draft, nothing else', async () => {
    const a = need(await act({ action: 'remove' }));
    expect(a.kind).toBe('removed');
    const file = draftFile(KEY);
    expect(file.types?.['baum']).toBeUndefined();
    expect(file.tasks?.['pruefen']).toBeUndefined();
    expect(file.views?.['alle']).toBeUndefined();
  });
});

describe('Aus Projekt importieren', () => {
  beforeEach(() => {
    OTHER = create(`Quelle ${testNo}`);
    seed(OTHER, ['gaertner']); // a role that the other project's file has no counterpart for in `KEY`
    const rt = runtime();
    const done = deploy(
      rt.projectDb(OTHER),
      parse(createDraftStore(rt.projectDb(OTHER)).get()?.overlay ?? ''),
      admin.id,
      { clock: rt.clock, templates: rt.templates },
    );
    if (!done.ok) throw new Error(JSON.stringify(done.problems));
  });

  it("lists the admin's other published projects with their types", async () => {
    const a = need(await act({ action: 'sources' }));
    const source = a.kind === 'sources' ? a.sources.find((s) => s.key === OTHER) : undefined;
    expect(source?.types).toEqual([{ key: 'baum', label: 'Baum' }]);
    expect(a.kind === 'sources' && a.sources.some((s) => s.key === KEY)).toBe(false);
  });

  it('copies the type of the other project into this draft, as a new key, with the roles it lacks dropped from its permissions', async () => {
    const a = need(await act({ action: 'import', project: OTHER, type: 'baum' }));
    expect(a.kind === 'copy' && a.copy.key).toBe('baum_kopie');
    expect(a.kind === 'copy' && a.copy.notes[0]).toContain('Rollen, die es in diesem Projekt nicht gibt');
    const file = draftFile(KEY);
    expect(file.types?.['baum_kopie']?.permissions).toEqual({ see: '$all', create: [] });
    expect(file.tasks?.['pruefen_kopie']).toBeDefined();
  });

  it('refuses a project the admin is no member of, and an unknown type', async () => {
    const r = await act({ action: 'import', project: OTHER, type: 'gibt_es_nicht' });
    expect(r.ok).toBe(false);
    const rt = runtime();
    const foreign = createProjectFromTemplate(
      rt.control,
      rt.projectDb,
      { name: 'Fremd', description: '', template: 'leer@1' },
      outsider.id,
      rt.clock,
    ).key;
    const r2 = await act({ action: 'import', project: foreign, type: 'baum' });
    expect(r2.ok).toBe(false);
  });
});

describe('the guard', () => {
  it('refuses a call without an admin session or without access to the project', async () => {
    await expect(act({ action: 'duplicate' }, null)).rejects.toThrow();
    await expect(act({ action: 'duplicate' }, outsider)).rejects.toThrow();
  });

  it('refuses a body that is not a call', async () => {
    const r = (await (page.actions.menu as (e: unknown) => Promise<unknown>)(
      event(admin, { action: 'drop_tables' }),
    )) as { status?: number };
    expect(r.status).toBe(400);
  });
});
