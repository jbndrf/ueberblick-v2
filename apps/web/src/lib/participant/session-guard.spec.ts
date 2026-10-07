import { describe, expect, it } from 'vitest';
import { SESSION_PARTICIPANT_HEADER } from '@ueberblick/core/sync';
import { sessionGuard } from './session-guard';

/** A server whose session belongs to `state.session`; it records what reached it. */
function fake(state: { session: string }) {
  const seen: { url: string; claimed: string | null }[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const claimed = new Headers(init?.headers).get(SESSION_PARTICIPANT_HEADER);
    seen.push({ url, claimed });
    return new Response('{}', {
      status: 200,
      headers: { [SESSION_PARTICIPANT_HEADER]: state.session },
    });
  };
  return { seen, fetch };
}

describe('session guard (WP-768)', () => {
  it('names the participant on run and sync requests, and lets a reply of the same participant through', async () => {
    const f = fake({ session: 'olga' });
    const guarded = sessionGuard(f.fetch, 'olga', () => undefined);
    expect((await guarded('/api/p/demo/runs', { method: 'POST' })).status).toBe(200);
    await guarded('/api/p/demo/runs/batch', { method: 'POST' });
    await guarded('/api/p/demo/sync?since=0');
    expect(f.seen.map((s) => s.claimed)).toEqual(['olga', 'olga', 'olga']);
  });

  it('leaves other requests alone', async () => {
    const f = fake({ session: 'felix' });
    const guarded = sessionGuard(f.fetch, 'olga', () => undefined);
    await guarded('/participant-api/demo/config/1');
    expect(f.seen[0]?.claimed).toBeNull();
  });

  it('a reply naming another participant rejects, announces once, and stops every later request unsent', async () => {
    const state = { session: 'olga' };
    const f = fake(state);
    let announced = 0;
    const guarded = sessionGuard(f.fetch, 'olga', () => void (announced += 1));
    await guarded('/api/p/demo/runs', { method: 'POST' });
    state.session = 'felix';
    await expect(guarded('/api/p/demo/sync?since=0')).rejects.toThrow(/another participant/);
    expect(announced).toBe(1);
    const before = f.seen.length;
    await expect(guarded('/api/p/demo/runs', { method: 'POST' })).rejects.toThrow();
    await expect(guarded('/api/p/demo/sync?since=0')).rejects.toThrow();
    expect(f.seen.length).toBe(before);
    expect(announced).toBe(1);
  });

  it('a reply without the header (an old proxy, an error page) is not a mismatch', async () => {
    const guarded = sessionGuard(
      async () => new Response('{}', { status: 502 }),
      'olga',
      () => undefined,
    );
    expect((await guarded('/api/p/demo/runs')).status).toBe(502);
  });

  it('guards every request under /api/p/<project>/: files, packs, preferences, tool data', async () => {
    const f = fake({ session: 'olga' });
    const guarded = sessionGuard(f.fetch, 'olga', () => undefined);
    const urls = [
      '/api/p/demo/blobs/abc',
      '/api/p/demo/blobs/abc?thumb=s',
      '/api/p/demo/packs',
      '/api/p/demo/packs/h/basis.pmtiles',
      '/api/p/demo/prefs',
      '/api/p/demo/tools/chat/read',
    ];
    for (const u of urls) await guarded(u);
    expect(f.seen.map((s) => s.claimed)).toEqual(urls.map(() => 'olga'));
  });

  it('a file or pack reply naming another participant stops the device', async () => {
    const f = fake({ session: 'felix' });
    const guarded = sessionGuard(f.fetch, 'olga', () => undefined);
    await expect(guarded('/api/p/demo/blobs/abc', { method: 'PUT' })).rejects.toThrow(/another participant/);
    await expect(guarded('/api/p/demo/packs')).rejects.toThrow();
  });
});
