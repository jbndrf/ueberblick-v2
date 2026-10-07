import { describe, expect, it, vi } from 'vitest';
import { createDeployClient } from './deploy-client';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const PLAN = {
  revision: 3,
  first: false,
  warnings: [],
  groups: [],
  versions: [],
  mappings: [],
  blockers: [],
};

describe('plan', () => {
  it('asks the builder route with the language and the choices, and returns the plan', async () => {
    const fetch = vi.fn(async () => json(PLAN));
    const plan = await createDeployClient({ project: 'muster', fetch }).plan({ baum: 'keep' }, 'de');
    expect(plan).toEqual(PLAN);
    const url = new URL(String((fetch.mock.calls[0] as unknown[])[0]), 'http://x');
    expect(url.pathname).toBe('/builder-api/muster/plan');
    expect(url.searchParams.get('locale')).toBe('de');
    expect(JSON.parse(url.searchParams.get('versions') ?? '')).toEqual({ baum: 'keep' });
  });

  it('sends no `versions` without a choice, and answers null when the read fails', async () => {
    const fetch = vi.fn(async () => json(PLAN));
    await createDeployClient({ project: 'm', fetch }).plan({}, 'en');
    expect(String((fetch.mock.calls[0] as unknown[])[0])).not.toContain('versions');
    expect(
      await createDeployClient({ project: 'm', fetch: async () => json({}, 500) }).plan({}, 'de'),
    ).toBeNull();
    expect(
      await createDeployClient({ project: 'm', fetch: async () => json({ nope: 1 }) }).plan({}, 'de'),
    ).toBeNull();
    expect(
      await createDeployClient({
        project: 'm',
        fetch: async () => {
          throw new Error('offline');
        },
      }).plan({}, 'de'),
    ).toBeNull();
  });
});

describe('deploy', () => {
  const request = {
    revision: 3,
    mappings: { p: { discard: true as const } },
    versions: { baum: 'keep' as const },
  };

  it('posts the revision, the mappings and the choices, and returns the version', async () => {
    const fetch = vi.fn(async () => json({ ok: true, version: 5, created: true, warnings: [] }));
    expect(await createDeployClient({ project: 'muster', fetch }).deploy(request)).toEqual({
      kind: 'deployed',
      version: 5,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/builder-api/muster/deploy');
    expect(JSON.parse(String(init.body))).toEqual(request);
  });

  it('names what refused it', async () => {
    const answer = (body: unknown, status: number) =>
      createDeployClient({ project: 'm', fetch: async () => json(body, status) }).deploy(request);
    expect(await answer({ ok: false, reason: 'problems', problems: [{}, {}] }, 422)).toEqual({
      kind: 'problems',
      count: 2,
    });
    expect(await answer({ ok: false, reason: 'mapping_required', paths: ['a'] }, 409)).toEqual({
      kind: 'mapping_required',
    });
    expect(await answer({ ok: false, reason: 'stale' }, 409)).toEqual({ kind: 'stale' });
    expect(await answer({}, 500)).toEqual({ kind: 'failed' });
  });
});

describe('preview (WP-373)', () => {
  const VIEW = { status: 'ready', problems: 0, version: 1, updatedAt: null, logins: [] };

  it('reads the preview with the language and resets it by POST; a bad answer is null', async () => {
    const fetch = vi.fn(async () => json(VIEW));
    const client = createDeployClient({ project: 'muster', fetch });
    expect(await client.preview('de')).toEqual(VIEW);
    expect(await client.resetPreview('en')).toEqual(VIEW);
    expect(fetch.mock.calls).toEqual([
      ['/builder-api/muster/preview?locale=de', { method: 'GET' }],
      ['/builder-api/muster/preview/reset?locale=en', { method: 'POST' }],
    ]);
    expect(
      await createDeployClient({ project: 'm', fetch: async () => json({}, 500) }).preview('de'),
    ).toBeNull();
    expect(
      await createDeployClient({ project: 'm', fetch: async () => json({ nope: 1 }) }).preview('de'),
    ).toBeNull();
    expect(
      await createDeployClient({
        project: 'm',
        fetch: async () => Promise.reject(new Error('x')),
      }).resetPreview('de'),
    ).toBeNull();
  });
});
