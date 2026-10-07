import { encodePage, SESSION_PARTICIPANT_HEADER, SYNC_PROTOCOL_VERSION } from '@ueberblick/core/sync';
import { goldenConfig } from '@ueberblick/core/testing';
import { serialize } from '@ueberblick/core';
import type { Bootstrap } from './http';

export const bootstrap: Bootstrap = {
  project: { key: 'demo', displayName: 'Musterstadt', icon: null, preview: false },
  participant: { id: 'vera', name: 'Vera', roles: ['verwaltung'], email: null, phone: null },
  infoPages: [],
  legalPages: [],
  session: { expiresAt: '2027-01-01T00:00:00.000Z' },
  login: null,
  version: 1,
  compiled: serialize(goldenConfig('templates/baumkataster/1.0.0.yaml')),
};

/** A scripted server: sync answers an empty snapshot, runs are accepted; `up` switches the network. */
export function server() {
  const state = {
    up: false,
    /** Whose session the cookie holds (the server names it on every reply and refuses a request made as another). */
    session: 'vera',
    seen: [] as string[],
    runs: [] as { id: string; configVersion: number }[],
    versions: { deployed: 1, live: [1] as number[] },
  };
  const emptyPage = () =>
    JSON.stringify(
      encodePage({
        header: {
          kind: 'snapshot',
          cursor: 5,
          head: 5,
          more: false,
          scopeFingerprint: 's1',
          versions: state.versions,
        },
        features: [],
        edges: [],
        observations: [],
        tombstones: [],
        runs: [],
        people: [],
      }),
    );
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const res = await answer(url, init);
    res.headers.set(SESSION_PARTICIPANT_HEADER, state.session);
    return res;
  };
  const answer = async (url: string, init?: RequestInit): Promise<Response> => {
    state.seen.push(url);
    if (!state.up) throw new TypeError('offline');
    const claimed = new Headers(init?.headers).get(SESSION_PARTICIPANT_HEADER);
    if (claimed !== null && claimed !== state.session)
      return new Response(JSON.stringify({ v: SYNC_PROTOCOL_VERSION, code: 'session_changed' }), {
        status: 409,
      });
    if (url.startsWith('/api/p/demo/sync')) return new Response(emptyPage(), { status: 200 });
    if (url.startsWith('/participant-api/demo/config/'))
      return new Response(JSON.stringify(bootstrap.compiled), { status: 200 });
    if (url === '/api/p/demo/runs') {
      const run = JSON.parse(String(init?.body)) as { id: string; configVersion: number };
      state.runs.push(run);
      return new Response(
        JSON.stringify({
          v: SYNC_PROTOCOL_VERSION,
          outcome: 'accepted',
          runId: run.id,
          seq: { from: 6, to: 6 },
        }),
        { status: 200 },
      );
    }
    return new Response('{}', { status: 404 });
  };
  return { state, fetch };
}
