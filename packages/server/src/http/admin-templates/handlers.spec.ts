import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { PROJECT_FILE_LIMITS, type TemplateFile } from '@ueberblick/core';
import type { Principal } from '../../auth/contract';
import { createAdminProjectsHandlers } from '../admin-projects';
import { embedGoldenRefs } from '@ueberblick/core/testing';
import { openControlDb } from '../../db/open';
import { publishTemplate } from '../../templates';
import type { EffectiveResult } from '../admin-projects';
import { createAdminTemplatesHandlers } from './handlers';

const admin = { kind: 'admin', id: 'a1' } as unknown as Principal;
const participant = { kind: 'participant', id: 'p1' } as unknown as Principal;
const FILE: TemplateFile = { schema: 'ueberblick/1', template: { key: 'leer', version: '1.0.0' } };

const golden = (rel: string): TemplateFile =>
  embedGoldenRefs(
    parse(
      readFileSync(fileURLToPath(new URL(`../../../../../fixtures/golden/${rel}`, import.meta.url)), 'utf8'),
    ),
  ) as TemplateFile;
const clock = { now: () => '2026-10-02T08:00:00Z' };

const authorize = (principal: Principal | null, key: string) =>
  principal === null
    ? new Response('{}', { status: 401 })
    : principal.kind !== 'admin'
      ? new Response('{}', { status: 403 })
      : key === 'unbekannt'
        ? new Response('{}', { status: 404 })
        : { projectKey: key };

function templates(over: { file?: EffectiveResult } = {}) {
  const control = openControlDb(':memory:');
  const h = createAdminTemplatesHandlers({
    authorizeAdmin: authorize,
    deployedFile: () => over.file ?? { ok: true, file: FILE },
    publishContext: () => ({ control, clock }),
  });
  const post = (body: unknown, principal: Principal | null = admin) =>
    h.POST({
      principal,
      request: new Request('http://x/api/admin/templates', {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    });
  const published = () =>
    control.prepare<{ source: string }>('SELECT source FROM templates ORDER BY key, version').all();
  return { post, published, control };
}
const ok = { project: 'baeume', key: 'meine', version: '1.0.0', label: 'Meine Vorlage' };

describe('POST /api/admin/templates', () => {
  it('publishes the deployed file under the new identity', async () => {
    const t = templates();
    const res = await t.post(ok);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ key: 'meine', version: '1.0.0', created: true });
    expect((JSON.parse(t.published()[0]?.source ?? '{}') as TemplateFile).template).toEqual({
      key: 'meine',
      version: '1.0.0',
      label: { de: 'Meine Vorlage', en: 'Meine Vorlage' },
    });
  });

  it('is admin only and project scoped', async () => {
    const t = templates();
    expect((await t.post(ok, null)).status).toBe(401);
    expect((await t.post(ok, participant)).status).toBe(403);
    expect((await t.post({ ...ok, project: 'unbekannt' })).status).toBe(404);
    expect(t.published()).toEqual([]);
  });

  it('field problems: key, version and label', async () => {
    const t = templates();
    const res = await t.post({ project: 'baeume', key: 'Bad Key', version: 'x', label: ' ' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { problems: { field: string }[] };
    expect(body.problems.map((p) => p.field)).toEqual(['key', 'version', 'label']);
    expect((await t.post('not json')).status).toBe(400);
    expect(t.published()).toEqual([]);
  });

  it('a project with nothing deployed answers 409', async () => {
    const t = templates({ file: { ok: false, code: 'not_published', problems: [] } });
    expect((await t.post(ok)).status).toBe(409);
  });

  it('a refused version (breaking in a minor) answers 422 with the messages, through the real gate', async () => {
    const candidate = golden('candidates/baumkataster/1.2.0.yaml');
    const t = templates({ file: { ok: true, file: candidate } });
    expect(publishTemplate(t.control, golden('templates/baumkataster/1.1.0.yaml'), clock).ok).toBe(true);
    const res = await t.post({
      project: 'baeume',
      key: 'baumkataster',
      version: '1.2.0',
      label: 'Baumkataster',
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { messages: string[] }).messages.length).toBeGreaterThan(0);
    expect(t.published()).toHaveLength(1);
  });
});

describe('project-file endpoints', () => {
  const h = (maxBytes?: number) =>
    createAdminProjectsHandlers({
      authorizeAdmin: authorize,
      effectiveFile: (key) =>
        key === 'kaputt'
          ? { ok: false, code: 'invalid', problems: [{ path: 'types', message: 'x' }] }
          : { ok: true, file: FILE },
      importFile: (text, by, name) =>
        text.includes('schema')
          ? { ok: true, key: 'neu', id: `${by}:${name ?? ''}` }
          : { ok: false, problems: [{ path: '', message: 'nope' }] },
      maxBytes,
    });
  /** A multipart upload with the Content-Length a browser sends (`declared` overrides it). */
  const upload = async (
    text: string,
    principal: Principal | null = admin,
    name?: string,
    declared?: string,
  ) => {
    const form = new FormData();
    form.set('file', new File([text], 'p.yaml'));
    if (name) form.set('name', name);
    const made = new Request('http://x/api/admin/projects/import', { method: 'POST', body: form });
    const bytes = await made.arrayBuffer();
    const headers: Record<string, string> = { 'content-type': made.headers.get('content-type') ?? '' };
    if (declared !== null) headers['content-length'] = declared ?? String(bytes.byteLength);
    return h(100).POST_IMPORT({
      principal,
      params: {},
      request: new Request(made.url, { method: 'POST', headers, body: bytes }),
    });
  };

  it('schema: the effective file as a YAML attachment', async () => {
    const res = h().GET_SCHEMA({
      principal: admin,
      params: { key: 'baeume' },
      request: new Request('http://x'),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="baeume-schema.yaml"');
    expect(parse(await res.text())).toEqual(FILE);
  });

  it('schema: scoped (401, 403, 404) and 409 when the file does not resolve', async () => {
    const get = (principal: Principal | null, key: string) =>
      h().GET_SCHEMA({ principal, params: { key }, request: new Request('http://x') }).status;
    expect(get(null, 'baeume')).toBe(401);
    expect(get(participant, 'baeume')).toBe(403);
    expect(get(admin, 'unbekannt')).toBe(404);
    expect(get(admin, 'kaputt')).toBe(409);
  });

  it('import: 201 with the new key, 422 with problems, 413 over the cap, 400 without a file', async () => {
    const created = await upload('schema: ueberblick/1', admin, 'Mein Projekt');
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ key: 'neu', id: 'a1:Mein Projekt' });
    const bad = await upload('kaputt');
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { problems: unknown[] }).problems).toHaveLength(1);
    expect((await upload('x'.repeat(101))).status).toBe(413);
    const none = await h().POST_IMPORT({
      principal: admin,
      params: {},
      request: new Request('http://x', {
        method: 'POST',
        headers: { 'content-length': '10' },
        body: 'not a form',
      }),
    });
    expect(none.status).toBe(400);
    expect((await upload('schema', null)).status).toBe(401);
    expect((await upload('schema', participant)).status).toBe(403);
  });

  it('a declared size over the cap is refused before the body is read; no length at all is 411', async () => {
    let read = false;
    const guarded = createAdminProjectsHandlers({
      authorizeAdmin: authorize,
      effectiveFile: () => ({ ok: true, file: FILE }),
      importFile: () => ({ ok: true, key: 'neu', id: 'x' }),
      maxBytes: 100,
    });
    const request = new Request('http://x/api/admin/projects/import', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=b', 'content-length': '999999999' },
      body: 'tiny',
    });
    Object.defineProperty(request, 'formData', {
      value: () => {
        read = true;
        return Promise.reject(new Error('read'));
      },
    });
    expect((await guarded.POST_IMPORT({ principal: admin, params: {}, request })).status).toBe(413);
    expect(read).toBe(false);
    expect((await upload('schema', admin, undefined, null as unknown as string)).status).toBe(411);
  });

  it('the default cap is the registry limit', () => {
    expect(PROJECT_FILE_LIMITS.maxBytes).toBe(1024 * 1024);
  });
});
