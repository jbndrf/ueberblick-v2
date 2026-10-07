import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { embedGoldenSource } from '@ueberblick/core/testing';
import type { TemplateFile } from '@ueberblick/core';
import { createVersionsCalls } from './client';

const golden = resolve(import.meta.dirname, '../../../../../../../../../fixtures/golden');
const template = (v: string): TemplateFile =>
  parse(
    embedGoldenSource(readFileSync(resolve(golden, `templates/baumkataster/${v}.yaml`), 'utf8')),
  ) as TemplateFile;

const reply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the Versionen page calls', () => {
  it('rollback posts the version to the builder route and reads the outcome', async () => {
    const fetch = vi.fn(async () => reply(200, { ok: true, version: 1, created: false, warnings: [] }));
    const calls = createVersionsCalls({ project: 'muster', fetch });
    expect(await calls.rollback(1)).toEqual({ ok: true, version: 1, warnings: [] });
    expect(fetch).toHaveBeenCalledWith(
      '/builder-api/muster/rollback',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ version: 1 }) }),
    );
  });

  it('a refused deploy keeps its reason and the paths that need a mapping', async () => {
    const fetch = vi.fn(async () => reply(409, { ok: false, reason: 'mapping_required', paths: ['a.b'] }));
    expect(await createVersionsCalls({ project: 'muster', fetch }).rollback(1)).toEqual({
      ok: false,
      reason: 'mapping_required',
      paths: ['a.b'],
    });
  });

  it('an unexpected status or a network error is a failed call', async () => {
    const calls = createVersionsCalls({ project: 'muster', fetch: async () => reply(500, {}) });
    expect(await calls.rollback(1)).toEqual({ ok: false, reason: 'failed' });
    const down = createVersionsCalls({
      project: 'muster',
      fetch: async () => {
        throw new Error('offline');
      },
    });
    expect(await down.discard()).toEqual({ ok: false, reason: 'failed' });
  });

  it('compare reads both stored files and groups the difference as a plan', async () => {
    const files: Record<string, TemplateFile> = { '1': template('1.0.0'), '2': template('1.1.0') };
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const n = String(input).split('/').pop() ?? '';
      return files[n] ? reply(200, files[n]) : reply(404, {});
    });
    const calls = createVersionsCalls({ project: 'muster', fetch });
    const same = await calls.compare(1, 1);
    expect(same).toMatchObject({ ok: true, plan: { entries: [] } });
    const diff = await calls.compare(1, 2);
    expect(diff.ok && diff.plan?.entries.length).toBeGreaterThan(0);
    expect(await calls.compare(1, 99)).toEqual({ ok: false, reason: 'failed' });
  });

  it('upgrade posts overlay and mappings; discard posts to the page route', async () => {
    const fetch = vi.fn(async () => reply(200, { ok: true, version: 2, created: true, warnings: [] }));
    const calls = createVersionsCalls({ project: 'muster', fetch });
    await calls.upgrade('extends: x', { 'a.b': { discard: true } });
    expect(fetch).toHaveBeenLastCalledWith(
      '/builder-api/muster/upgrade',
      expect.objectContaining({
        body: JSON.stringify({ overlay: 'extends: x', mappings: { 'a.b': { discard: true } } }),
      }),
    );
    expect(await calls.discard()).toEqual({ ok: true });
    expect(fetch).toHaveBeenLastCalledWith('/admin/projects/muster/versions/discard', expect.anything());
  });

  it("movePlan asks for the dry run of the version in the admin's language and returns the view", async () => {
    const view = { from: 1, to: 2, pinned: 3, types: [], plan: {} };
    const fetch = vi.fn(async () => reply(200, { ok: true, view }));
    const calls = createVersionsCalls({ project: 'muster', fetch });
    expect(await calls.movePlan(1, 'de')).toEqual({ ok: true, view });
    expect(fetch).toHaveBeenCalledWith('/admin/projects/muster/versions/move?version=1&locale=de');
  });

  it("a refused dry run or move answers with the engine's message in the asked language", async () => {
    const problems = [{ message: { en: 'Nothing pinned.', de: 'Nichts festgehalten.' } }];
    const fetch = vi.fn(async () => reply(422, { ok: false, problems }));
    const calls = createVersionsCalls({ project: 'muster', fetch });
    expect(await calls.movePlan(1, 'de')).toEqual({ ok: false, reason: 'Nichts festgehalten.' });
    expect(await calls.movePins(1, {}, 'en')).toEqual({ ok: false, reason: 'Nothing pinned.' });
  });

  it('movePins posts the version and the mappings and reads how many Objekte moved', async () => {
    const fetch = vi.fn(async () => reply(200, { ok: true, from: 1, to: 2, unpinned: 3, moved: 3 }));
    const calls = createVersionsCalls({ project: 'muster', fetch });
    const mappings = { 'types.baum.properties.x': { discard: true as const } };
    expect(await calls.movePins(1, mappings, 'de')).toEqual({ ok: true, to: 2, unpinned: 3 });
    expect(fetch).toHaveBeenCalledWith(
      '/admin/projects/muster/versions/move',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ version: 1, mappings }) }),
    );
  });

  it('a network error on the move is a failed call', async () => {
    const down = createVersionsCalls({
      project: 'muster',
      fetch: async () => {
        throw new Error('offline');
      },
    });
    expect(await down.movePins(1, {}, 'de')).toEqual({ ok: false, reason: 'failed' });
    expect(await down.movePlan(1, 'de')).toEqual({ ok: false, reason: 'failed' });
  });
});
