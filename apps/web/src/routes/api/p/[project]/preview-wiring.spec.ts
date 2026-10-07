// WP-341: the participant routes resolve `<key>__vorschau`; every other route stays blind to it; the draft PUT
// refreshes the preview; and the real project database is never touched by a preview cycle.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import { embedGoldenRefs } from '@ueberblick/core/testing';
import {
  createDraftStore,
  deployedVersion,
  deployProject,
  isAuthError,
  publishTemplate,
  readSessionCookie,
  seedDraft,
  sessionCookie,
  versions,
} from '@ueberblick/server';
import { SYNC_PROTOCOL_VERSION, type TemplateFile } from '@ueberblick/core';
import { createRuntime, type Runtime } from '../../../../lib/server/runtime';

// `$lib` has no alias in the root vitest config: the route files' `$lib/server/*` imports resolve to the real files by
// relative path, and `runtime()` is the runtime of the current test world.
const state = vi.hoisted(() => ({ rt: undefined as unknown }));
vi.mock('../../../../lib/server/runtime', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  runtime: () => state.rt,
}));
vi.mock('$lib/server/runtime', () => ({ runtime: () => state.rt }));
vi.mock('$lib/server/config', () => import('../../../../lib/server/config'));
vi.mock('$lib/server/authz', () => import('../../../../lib/server/authz'));
vi.mock('$lib/server/handlers/http', () => import('../../../../lib/server/handlers/http'));
vi.mock('$lib/server/handlers/admin', () => import('../../../../lib/server/handlers/admin'));
vi.mock('$lib/server/handlers/builder-draft', () => import('../../../../lib/server/handlers/builder-draft'));

const template = embedGoldenRefs(
  parse(
    readFileSync(
      fileURLToPath(
        new URL('../../../../../../../fixtures/golden/templates/baumkataster/1.0.0.yaml', import.meta.url),
      ),
      'utf8',
    ),
  ),
) as TemplateFile;
const PREVIEW = 'demo__vorschau';
const clock = { now: () => '2026-10-01T10:00:00Z' };
const overlay = stringify({ schema: 'ueberblick/1', extends: 'baumkataster@1' });

// Cold transform of the heavy route modules (OGC, MCP, admin, builder) must not count as test time: warm the
// transform cache once, with its own hook timeout (WP-399; 87–120 s in ~30-worker trains on 2026-10-03; WP-1003 (icons by deep import) cut the hook to ~7 s
// at load 33, so 120 s again). The per-test resetModules then only re-evaluates.
beforeAll(async () => {
  await Promise.all([
    import('./ogc/[...path]/+server'),
    import('../../mcp/[project]/+server'),
    import('../../admin/p/[project]/versions/+server'),
    import('../../admin/p/[project]/participants/+server'),
    import('../../../(builder)/builder-api/[project]/draft/+server'),
    import('../../../(builder)/builder-api/[project]/preview/+server'),
    import('../../../(participant)/participant-api/bootstrap/+server'),
    import('./sync/+server'),
    import('./runs/+server'),
    import('./blobs/[sha]/+server'),
    import('./prefs/+server'),
  ]);
}, 120_000);

// the route wirings memoise handlers over the runtime of their first call: a fresh module graph per test
beforeEach(() => vi.resetModules());

const dirs: string[] = [];
const runtimes: Runtime[] = [];
afterEach(() => {
  runtimes.splice(0).forEach((r) => r.stop());
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function world() {
  const dir = mkdtempSync(join(tmpdir(), 'ub-prevwire-'));
  dirs.push(dir);
  const timers: Array<() => void> = [];
  const rt = createRuntime({
    dataDir: dir,
    secureCookies: false,
    schedulePreview: (fn) => {
      timers.push(fn);
      return () => timers.splice(timers.indexOf(fn), 1);
    },
  });
  state.rt = rt;
  runtimes.push(rt);
  rt.control
    .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
    .run('p1', 'demo', 'Demo', 'x');
  publishTemplate(rt.control, template, clock);
  const real = rt.projectDb('demo');
  deployProject(real, template, 'admin', { clock, afterDeploy: () => undefined });
  seedDraft(real, {
    template: 'baumkataster',
    templateVersion: '1.0.0',
    overlay,
    by: 'root',
    at: clock.now(),
  });
  const preview = rt.ensurePreview('p1');
  rt.projectDb(PREVIEW)
    .prepare('INSERT INTO participants (id, name, roles) VALUES (?,?,?)')
    .run('tester', 'Tester', '["kontrolle"]');
  rt.control
    .prepare('INSERT INTO credentials (token, project_id, participant_id) VALUES (?,?,?)')
    .run('PREV', preview.id, 'tester');
  real
    .prepare('INSERT INTO participants (id, name, roles) VALUES (?,?,?)')
    .run('anna', 'Anna', '["kontrolle"]');
  rt.control
    .prepare('INSERT INTO credentials (token, project_id, participant_id) VALUES (?,?,?)')
    .run('REAL', 'p1', 'anna');
  const fire = (): void => timers.splice(0).forEach((f) => f());
  return { rt, real, timers, fire };
}

const SYNC = `http://x/?since=0&v=${SYNC_PROTOCOL_VERSION}`;
const as = (rt: Runtime, token: string, init: RequestInit & { url?: string } = {}): Request => {
  const s = rt.auth.exchange(token);
  if (isAuthError(s)) throw new Error(`exchange failed: ${s.code}`);
  return new Request(init.url ?? 'http://x/', {
    ...init,
    headers: { cookie: sessionCookie('participant', s), ...init.headers },
  });
};
const eventOf = (rt: Runtime, request: Request, params: Record<string, string>) =>
  ({
    request,
    params,
    locals: { admin: null, participant: rt.auth.authenticate(readSessionCookie(request, 'participant')) },
  }) as never;
const dbState = (db: ReturnType<Runtime['projectDb']>): string =>
  JSON.stringify([
    ['observations', 'runs', 'features', 'config_versions', 'participants'].map(
      (t) => db.prepare<{ n: number }>(`SELECT count(*) n FROM ${t}`).get()?.n,
    ),
    db.prepare<{ m: number | null }>('SELECT max(seq) m FROM observations').get()?.m,
    versions(db).map((v) => v.hash),
  ]);

describe('draft save refreshes the preview', () => {
  it('two accepted saves give one deploy into the preview; a refused save schedules nothing; the real DB stays', async () => {
    const { rt, real, timers, fire } = world();
    const accountId = await rt.auth.createAdmin('a@example.org', 'correct horse battery');
    rt.control
      .prepare('INSERT INTO memberships (account_id, project_id, role) VALUES (?,?,?)')
      .run(accountId, 'p1', 'verwaltung');
    const adminPrincipal = { kind: 'admin', id: accountId, projectId: null, roles: [] };
    const { PUT } = await import('../../../(builder)/builder-api/[project]/draft/+server');
    const save = (revision: number, text: string) =>
      PUT({
        request: new Request('http://x/', {
          method: 'PUT',
          body: JSON.stringify({ overlay: text, revision }),
        }),
        params: { project: 'demo' },
        locals: { admin: adminPrincipal },
      } as never);
    expect((await save(99, overlay)).status).toBe(409);
    expect(timers).toHaveLength(0);
    expect((await save(1, `${overlay}# a\n`)).status).toBe(200);
    expect((await save(2, `${overlay}# b\n`)).status).toBe(200);
    expect(timers).toHaveLength(1);
    expect(deployedVersion(rt.projectDb(PREVIEW))).toBeUndefined();
    fire();
    expect(deployedVersion(rt.projectDb(PREVIEW))?.version).toBe(1);
    expect(rt.previews.previewState('demo')).toMatchObject({ status: 'ready', version: 1 });
    // the real project's own deployed version and its history are untouched
    expect(deployedVersion(real)?.version).toBe(1);
    expect(versions(real)).toHaveLength(1);
    expect(createDraftStore(real).get()?.revision).toBe(3);
  });
});

describe('participant routes resolve the preview, other routes stay blind', () => {
  it('bootstrap, sync, runs, blobs and prefs serve a preview session on the preview key', async () => {
    const { rt, fire } = world();
    rt.previews.schedulePreviewRefresh('demo');
    fire();
    const bootstrap = await import('../../../(participant)/participant-api/bootstrap/+server');
    const sync = await import('./sync/+server');
    const runs = await import('./runs/+server');
    const blobs = await import('./blobs/[sha]/+server');
    const prefs = await import('./prefs/+server');
    const p = { project: PREVIEW };

    const boot = await bootstrap.GET(eventOf(rt, as(rt, 'PREV'), {}));
    expect(boot.status).toBe(200);
    expect(await boot.json()).toMatchObject({ project: { key: PREVIEW, displayName: 'Demo' } });
    expect((await sync.GET(eventOf(rt, as(rt, 'PREV', { url: SYNC }), p))).status).toBe(200);
    expect((await runs.POST(eventOf(rt, as(rt, 'PREV', { method: 'POST', body: '{}' }), p))).status).toBe(
      400,
    );
    expect(
      (await blobs.HEAD(eventOf(rt, as(rt, 'PREV', { method: 'HEAD' }), { ...p, sha: 'a'.repeat(64) })))
        .status,
    ).not.toBe(403);
    expect((await prefs.GET(eventOf(rt, as(rt, 'PREV'), p))).status).toBe(200);
  });

  it('a real session on the preview key is refused on every participant route', async () => {
    const { rt, fire } = world();
    rt.previews.schedulePreviewRefresh('demo');
    fire();
    const sync = await import('./sync/+server');
    const runs = await import('./runs/+server');
    const blobs = await import('./blobs/[sha]/+server');
    const prefs = await import('./prefs/+server');
    const p = { project: PREVIEW };
    expect((await sync.GET(eventOf(rt, as(rt, 'REAL', { url: SYNC }), p))).status).toBe(403);
    expect((await runs.POST(eventOf(rt, as(rt, 'REAL', { method: 'POST', body: '{}' }), p))).status).toBe(
      403,
    );
    expect(
      (await blobs.HEAD(eventOf(rt, as(rt, 'REAL', { method: 'HEAD' }), { ...p, sha: 'a'.repeat(64) })))
        .status,
    ).toBe(403);
    expect((await prefs.GET(eventOf(rt, as(rt, 'REAL'), p))).status).toBe(403);
    // and a preview session on the real key
    expect((await sync.GET(eventOf(rt, as(rt, 'PREV', { url: SYNC }), { project: 'demo' }))).status).toBe(
      403,
    );
  });

  it(
    'OGC, MCP, admin and builder routes refuse the preview key for a preview session',
    { timeout: 30_000 },
    async () => {
      const { rt, fire } = world();
      rt.previews.schedulePreviewRefresh('demo');
      fire();
      const ogc = await import('./ogc/[...path]/+server');
      const mcp = await import('../../mcp/[project]/+server');
      const adminVersions = await import('../../admin/p/[project]/versions/+server');
      const adminParticipants = await import('../../admin/p/[project]/participants/+server');
      const draft = await import('../../../(builder)/builder-api/[project]/draft/+server');
      const status = await import('../../../(builder)/builder-api/[project]/preview/+server');
      const p = { project: PREVIEW };
      const table: Array<[string, () => Promise<Response> | Response]> = [
        ['ogc', () => ogc.GET(eventOf(rt, as(rt, 'PREV'), { ...p, path: 'collections' }))],
        ['mcp', () => mcp.POST(eventOf(rt, as(rt, 'PREV', { method: 'POST', body: '{}' }), p))],
        ['admin versions', () => adminVersions.GET(eventOf(rt, as(rt, 'PREV'), p))],
        ['admin participants', () => adminParticipants.GET(eventOf(rt, as(rt, 'PREV'), p))],
        ['builder draft', () => draft.GET(eventOf(rt, as(rt, 'PREV'), p))],
        ['builder preview status', () => status.GET(eventOf(rt, as(rt, 'PREV'), p))],
      ];
      for (const [name, call] of table) {
        const res = await call();
        // a preview session is a participant session: the admin routes see no admin session at all (WP-705)
        expect([401, 403, 404], name).toContain(res.status);
      }
      // an admin of the real project has no membership in the preview
      for (const [name, key] of [['draft', 'demo__vorschau']] as const) {
        const r = draft.GET({
          params: { project: key },
          locals: { admin: { kind: 'admin', id: 'other' } },
        } as never);
        expect([403, 404], name).toContain((await r).status);
      }
    },
  );

  it('a whole preview cycle (refresh, sync, run, discard) leaves the real project database unchanged', async () => {
    const { rt, real, fire } = world();
    const before = dbState(real);
    const draftBefore = JSON.stringify(createDraftStore(real).get());
    rt.previews.schedulePreviewRefresh('demo');
    fire();
    const sync = await import('./sync/+server');
    await sync.GET(eventOf(rt, as(rt, 'PREV', { url: SYNC }), { project: PREVIEW }));
    const runs = await import('./runs/+server');
    await runs.POST(eventOf(rt, as(rt, 'PREV', { method: 'POST', body: '{}' }), { project: PREVIEW }));
    rt.dropPreview('p1');
    expect(dbState(real)).toBe(before);
    expect(JSON.stringify(createDraftStore(real).get())).toBe(draftBefore);
  });
});
