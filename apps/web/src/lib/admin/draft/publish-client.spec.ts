import { describe, expect, it } from 'vitest';
import { builderHref, createPublishClient } from './publish-client';
import type { DraftStatusView } from './publish-client';

const STATUS: DraftStatusView = {
  dirty: true,
  neverPublished: false,
  problems: 0,
  revision: 3,
  type: 'baum',
};

function client(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof globalThis.fetch;
  return { calls, api: createPublishClient({ project: 'muster', fetch }) };
}
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('status', () => {
  it('reads the draft status of the project', async () => {
    const { api, calls } = client(() => reply(200, STATUS));
    expect(await api.status()).toEqual(STATUS);
    expect(calls[0]?.url).toBe('/api/admin/p/muster/draft/status');
  });

  it('is null when the call fails, so the shell shows no bar instead of a wrong one', async () => {
    expect(await client(() => reply(500, {})).api.status()).toBeNull();
    expect(
      await client(() => {
        throw new Error('offline');
      }).api.status(),
    ).toBeNull();
    expect(await client(() => reply(200, { nonsense: true })).api.status()).toBeNull();
  });
});

describe('builderHref', () => {
  it('opens the builder of the Objektart, or the project page when none is known', () => {
    expect(builderHref('muster', 'baum')).toBe('/admin/projects/muster/types/baum/builder');
    expect(builderHref('muster', null)).toBe('/admin/projects/muster/versions');
  });
});
