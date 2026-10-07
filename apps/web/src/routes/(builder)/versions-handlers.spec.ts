import { describe, expect, it, vi } from 'vitest';
import type { DeployOutcome } from '@ueberblick/builder';
import type { Principal } from '@ueberblick/server';
import type { DeployPlan } from '../../lib/admin/deploy/types';
import type { PlanOptions } from './builder-versions';
import { createVersionsHandlers, parseChoices, type VersionsPort } from './versions-handlers';

const admin = { kind: 'admin', id: 'admin-1' } as unknown as Principal;

function setup(
  deploy: DeployOutcome = { ok: true, version: 2, created: true, warnings: [] },
  deny?: Response,
) {
  const service = {
    snapshot: vi.fn(() => ({ versions: [], deployed: null, featureCounts: {}, upgrade: null })),
    versionFile: vi.fn((n: number) =>
      n === 1 ? ({ schema: 's', template: { key: 'k', version: '1.0.0' } } as never) : undefined,
    ),
    planDraft: vi.fn<(opts: PlanOptions) => DeployPlan>(() => ({
      revision: 3,
      first: false,
      warnings: [],
      groups: [],
      versions: [],
      mappings: [],
      blockers: [],
    })),
    compareFiles: vi.fn(() => ({ live: null, draft: 'a: 1\n' })),
    deployDraft: vi.fn<VersionsPort['deployDraft']>(() => deploy),
    rollback: vi.fn((_by: string, n: number) => (n === 1 ? deploy : undefined)),
    upgrade: vi.fn(() => deploy),
  } satisfies VersionsPort;
  const publish = vi.fn(() => ({ ok: true, created: true }) as const);
  const h = createVersionsHandlers({
    authorize: (principal) => deny ?? { projectKey: 'muster', principal: principal as Principal },
    service: () => service,
    publish,
    now: () => 'now',
  });
  const call = (body?: unknown, params: Record<string, string> = { project: 'muster' }) => ({
    params,
    locals: { admin: admin },
    request: new Request('http://x/', {
      method: 'POST',
      body: body === undefined ? '' : JSON.stringify(body),
    }),
  });
  return { h, service, publish, call };
}

describe('COMPARE', () => {
  it('answers the live and the draft file text to an admin only', async () => {
    const { h, call } = setup();
    const res = h.COMPARE(call());
    expect(await res.json()).toEqual({ live: null, draft: 'a: 1\n' });
    const denied = setup(undefined, new Response(null, { status: 403 }));
    expect(denied.h.COMPARE(denied.call()).status).toBe(403);
    expect(denied.service.compareFiles).not.toHaveBeenCalled();
  });
});

describe('parseChoices', () => {
  it('accepts a map of type to choice name; the engine judges the names', () => {
    expect(parseChoices(undefined)).toEqual({});
    expect(parseChoices({ baum: 'keep', zaun: 'move' })).toEqual({ baum: 'keep', zaun: 'move' });
    for (const v of [{ a: 1 }, [], 'x']) expect(parseChoices(v)).toBeUndefined();
  });
});

describe('versions routes', () => {
  it('pass a refusal through unchanged', async () => {
    const { h, call } = setup(undefined, new Response('no', { status: 403 }));
    for (const res of [
      h.GET(call()),
      h.GET_VERSION(call()),
      await h.DEPLOY(call({})),
      await h.ROLLBACK(call({})),
      await h.UPGRADE(call({})),
      await h.PUBLISH(call({})),
    ]) {
      expect(res.status).toBe(403);
    }
  });

  it('GET answers the snapshot, and a version file or 404', async () => {
    const { h, call } = setup();
    expect(((await h.GET(call()).json()) as { versions: unknown[] }).versions).toEqual([]);
    expect(h.GET_VERSION(call(undefined, { project: 'muster', version: '1' })).status).toBe(200);
    expect(h.GET_VERSION(call(undefined, { project: 'muster', version: '9' })).status).toBe(404);
    expect(h.GET_VERSION(call(undefined, { project: 'muster', version: 'x' })).status).toBe(404);
  });

  it('PLAN answers the dry run of the saved draft, for an admin only', async () => {
    const { h, service, call } = setup();
    const res = h.PLAN(call());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ revision: 3, warnings: [], groups: [], blockers: [] });
    expect(service.planDraft).toHaveBeenCalledWith({ choices: {}, locale: 'en' });
    const denied = setup(undefined, new Response('no', { status: 403 }));
    expect(denied.h.PLAN(denied.call()).status).toBe(403);
    expect(denied.service.planDraft).not.toHaveBeenCalled();
  });

  it('PLAN passes `?versions=` and `?locale=` to the service and refuses a malformed choice map', async () => {
    const { h, service, call } = setup();
    const c = call();
    const url = `http://x/?locale=de&versions=${encodeURIComponent('{"baum":"keep"}')}`;
    expect(h.PLAN({ ...c, request: new Request(url) }).status).toBe(200);
    expect(service.planDraft).toHaveBeenCalledWith({ choices: { baum: 'keep' }, locale: 'de' });
    for (const bad of ['nope', '[1]', '{"baum":3}'])
      expect(
        h.PLAN({ ...c, request: new Request(`http://x/?versions=${encodeURIComponent(bad)}`) }).status,
      ).toBe(400);
  });

  it('DEPLOY passes the admin, revision, mappings and the choice per Objektart to the service', async () => {
    const { h, service, call } = setup();
    const res = await h.DEPLOY(
      call({ revision: 4, mappings: { p: { discard: true } }, versions: { baum: 'keep' } }),
    );
    expect(res.status).toBe(200);
    expect(service.deployDraft).toHaveBeenCalledWith(
      'admin-1',
      4,
      { p: { discard: true } },
      { baum: 'keep' },
    );
    await h.DEPLOY(call({ revision: 4 }));
    expect(service.deployDraft).toHaveBeenLastCalledWith('admin-1', 4, {}, {});
    expect((await h.DEPLOY(call({ revision: 4, versions: { baum: 3 } }))).status).toBe(400);
  });

  it('DEPLOY maps outcomes to statuses: problems 422, mapping_required and stale 409', async () => {
    const cases: [DeployOutcome, number][] = [
      [{ ok: false, reason: 'problems', problems: [] }, 422],
      [{ ok: false, reason: 'mapping_required', paths: ['a'] }, 409],
      [{ ok: false, reason: 'stale' }, 409],
    ];
    for (const [o, status] of cases) {
      const { h, call } = setup(o);
      const res = await h.DEPLOY(call({ revision: 1 }));
      expect(res.status).toBe(status);
      expect(((await res.json()) as { reason: string }).reason).toBe((o as { reason: string }).reason);
    }
  });

  it('DEPLOY refuses a malformed body with 400 and an oversized one with 413', async () => {
    const { h, call } = setup();
    expect((await h.DEPLOY(call({ revision: 'x' }))).status).toBe(400);
    expect((await h.DEPLOY(call({ revision: 1, mappings: { a: 3 } }))).status).toBe(400);
    const c = call();
    const big = {
      ...c,
      request: new Request('http://x/', { method: 'POST', body: '{"a":"' + 'x'.repeat(1_000_001) + '"}' }),
    };
    expect((await h.DEPLOY(big)).status).toBe(413);
    const notJson = { ...c, request: new Request('http://x/', { method: 'POST', body: 'nope' }) };
    expect((await h.DEPLOY(notJson)).status).toBe(400);
  });

  it('ROLLBACK is a POST with a version; an unknown version is 404', async () => {
    const { h, service, call } = setup();
    expect((await h.ROLLBACK(call({ version: 1 }))).status).toBe(200);
    expect(service.rollback).toHaveBeenCalledWith('admin-1', 1);
    expect((await h.ROLLBACK(call({ version: 7 }))).status).toBe(404);
    expect((await h.ROLLBACK(call({}))).status).toBe(400);
  });

  it('UPGRADE and PUBLISH check their bodies', async () => {
    const { h, service, publish, call } = setup();
    expect((await h.UPGRADE(call({ overlay: 'x: 1', mappings: {} }))).status).toBe(200);
    expect(service.upgrade).toHaveBeenCalledWith('admin-1', 'x: 1', {}, 'now');
    expect((await h.UPGRADE(call({ mappings: {} }))).status).toBe(400);
    expect((await h.PUBLISH(call({ template: 't' }))).status).toBe(200);
    expect(publish).toHaveBeenCalledWith('t');
    expect((await h.PUBLISH(call({}))).status).toBe(400);
  });

  it('PUBLISH answers 409 for a refused version and 422 for an invalid file', async () => {
    const { h, publish, call } = setup();
    publish.mockReturnValueOnce({
      ok: false,
      reason: 'refused',
      codes: ['breaking_in_minor'],
      messages: [],
    } as never);
    expect((await h.PUBLISH(call({ template: 't' }))).status).toBe(409);
    publish.mockReturnValueOnce({ ok: false, reason: 'invalid', messages: [] } as never);
    expect((await h.PUBLISH(call({ template: 't' }))).status).toBe(422);
  });
});
