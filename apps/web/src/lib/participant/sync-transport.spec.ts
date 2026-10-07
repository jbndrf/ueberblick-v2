import { describe, expect, it } from 'vitest';
import { SyncProtocolError } from '@ueberblick/core/sync';
import type { FetchLike } from './http';
import { createEncodedSyncTransport, SYNC_UNAUTHENTICATED } from './sync-transport';

const reply = (status: number, body: unknown): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

function recorder(answer: (url: string, init?: RequestInit) => Response | Error) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) });
    const r = answer(url, init);
    if (r instanceof Error) throw r;
    return r;
  };
  return { calls, fetch };
}

describe('sync transport', () => {
  it('asks for one page with the query of the protocol and hands back the raw text', async () => {
    const r = recorder(() => reply(200, '{"v":1}'));
    const t = createEncodedSyncTransport('demo', r.fetch);
    const text = await t.fetchEncoded({ since: 0, scope: '', v: 1, after: 5, pin: 9, limit: 100 });
    expect(text).toBe('{"v":1}');
    expect(r.calls[0]?.url).toBe('/api/p/demo/sync?since=0&scope=&v=1&after=5&pin=9&limit=100');
  });

  it('a version mismatch and a malformed request are typed protocol errors; anything else is a plain error', async () => {
    const fetchWith = (status: number, body: unknown) =>
      createEncodedSyncTransport('demo', recorder(() => reply(status, body)).fetch).fetchEncoded({
        since: 1,
        scope: 's',
        v: 1,
      });
    await expect(fetchWith(409, { code: 'version_mismatch', error: 'x' })).rejects.toBeInstanceOf(
      SyncProtocolError,
    );
    await expect(fetchWith(500, 'boom')).rejects.not.toBeInstanceOf(SyncProtocolError);
    await expect(fetchWith(401, {})).rejects.toThrow(SYNC_UNAUTHENTICATED);
  });
});
