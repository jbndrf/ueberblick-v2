// WP-373: the preview endpoint lists the preview logins (admin only), a reset keeps the tokens, and a deploy of the real
// project carries the preview over through the runtime's `afterDeploy` instead of discarding it.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import { embedGoldenRefs } from '@ueberblick/core/testing';
import {
  deployedVersion,
  deployProject,
  isAuthError,
  publishTemplate,
  seedDraft,
  type Principal,
} from '@ueberblick/server';
import type { TemplateFile } from '@ueberblick/core';
import { createRuntime, type Runtime } from '../runtime';

const state = vi.hoisted(() => ({ rt: undefined as unknown, admin: true }));
vi.mock('../runtime', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  runtime: () => state.rt,
}));
vi.mock('../authz', () => ({
  authorizeAdmin: (principal: unknown, projectKey: string) =>
    state.admin && principal !== null
      ? { projectKey, principal }
      : new Response(JSON.stringify({ error: 'no' }), { status: 401 }),
}));
const { previewHandlers } = await import('./preview');

const template = embedGoldenRefs(
  parse(
    readFileSync(
      fileURLToPath(
        new URL('../../../../../../fixtures/golden/templates/baumkataster/1.0.0.yaml', import.meta.url),
      ),
      'utf8',
    ),
  ),
) as TemplateFile;
const clock = { now: () => '2026-10-02T10:00:00Z' };
const overlay = stringify({ schema: 'ueberblick/1', extends: 'baumkataster@1' });
const dirs: string[] = [];
const runtimes: Runtime[] = [];
afterEach(() => {
  runtimes.splice(0).forEach((r) => r.stop());
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function world() {
  const dir = mkdtempSync(join(tmpdir(), 'ub-prevlogins-'));
  dirs.push(dir);
  const rt = createRuntime({ dataDir: dir, secureCookies: false, schedulePreview: () => () => undefined });
  state.rt = rt;
  state.admin = true;
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
  return { rt, real };
}

const principal = { kind: 'admin', id: 'a1', projectId: null, roles: [] } as unknown as Principal;
const call = (method: 'GET' | 'POST', query = '') =>
  ({
    params: { project: 'demo' },
    locals: { admin: principal },
    getClientAddress: () => '127.0.0.1',
    request: new Request(`http://x/builder-api/demo/preview${query}`, { method }),
  }) as never;

interface Body {
  status: string;
  logins: { role: string | null; label: string; token: string; link: string; participantId: string }[];
}

describe('GET /builder-api/<project>/preview', () => {
  it('lists the logins (each draft role plus Keine Rolle) for the admin, and refuses anyone else', async () => {
    const { rt } = world();
    rt.previews.refreshPreview('demo');
    const res = previewHandlers.GET(call('GET', '?locale=de'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as Body;
    const roles = Object.keys(template.roles ?? {});
    expect(body.status).toBe('ready');
    expect(body.logins.map((l) => l.role)).toEqual([...roles, null]);
    for (const l of body.logins) {
      expect(l.link).toBe(`/login?token=${encodeURIComponent(l.token)}`);
      expect(isAuthError(rt.auth.exchange(l.token))).toBe(false);
    }
    state.admin = false;
    expect(previewHandlers.GET(call('GET')).status).toBe(401);
  });

  it('WP-505: a project with a draft and no preview yet gets its preview and logins on the first ask', async () => {
    world();
    const body = (await previewHandlers.GET(call('GET')).json()) as Body;
    expect(body.status).toBe('ready');
    expect(body.logins.length).toBeGreaterThan(0);
  });
});

describe('POST /builder-api/<project>/preview/reset', () => {
  it('regenerates the preview and leaves the logins (the same tokens)', async () => {
    const { rt } = world();
    rt.previews.refreshPreview('demo');
    const before = (await previewHandlers.GET(call('GET')).json()) as Body;
    const res = previewHandlers.POST(call('POST'));
    expect(res.status).toBe(200);
    const after = (await res.json()) as Body;
    expect(after.logins.map((l) => l.token)).toEqual(before.logins.map((l) => l.token));
    expect(after.logins[0]?.participantId).not.toBe(before.logins[0]?.participantId);
    expect(rt.projectDb('demo__vorschau').prepare('SELECT count(*) n FROM features').get()).toMatchObject({
      n: expect.any(Number) as number,
    });
  });
});

describe('a deploy of the real project', () => {
  it('carries the preview over (a new version, the preview and its tokens stay) instead of dropping it', async () => {
    const { rt, real } = world();
    rt.previews.refreshPreview('demo');
    const tokens = rt.previews.previewLogins('demo').map((l) => l.token);
    const previewDb = rt.projectDb('demo__vorschau');
    const first = deployedVersion(previewDb)?.version;
    const next = parse(
      stringify({ ...template, template: { ...template.template, version: '1.0.1' } }),
    ) as TemplateFile;
    deployProject(real, next, 'admin', { clock, afterDeploy: () => rt.services.afterDeploy('demo') });
    expect(rt.projectDb('demo__vorschau')).toBe(previewDb); // the same open preview database
    expect(deployedVersion(previewDb)?.version).toBeGreaterThanOrEqual(first ?? 0);
    expect(rt.previews.previewState('demo').status).toBe('ready');
    expect(rt.previews.previewLogins('demo').map((l) => l.token)).toEqual(tokens);
  });
});
