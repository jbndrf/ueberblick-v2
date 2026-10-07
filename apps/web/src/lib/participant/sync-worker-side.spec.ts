import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { IdbEnv, WorkerSideDeps } from '@ueberblick/client';
import type { Instant } from '@ueberblick/core/model';
import { createWorkerSide, WORKER_CONFIG_PARTICIPANT, WORKER_CONFIG_PROJECT } from './sync-worker-side';

const env = { factory: new IDBFactory(), keyRange: IDBKeyRange } as unknown as IdbEnv;
const now = () => '2026-09-30T10:00:00.000Z' as Instant;
const init = (config: Record<string, string>) => ({
  v: 1,
  kind: 'init' as const,
  name: 'ub-demo-anna',
  config,
});

describe('createWorkerSide', () => {
  it('builds the page transport for the project it is started with, and its adapters', async () => {
    const seen: string[] = [];
    const side: WorkerSideDeps = createWorkerSide({
      fetch: async (url) => {
        seen.push(url);
        return new Response('{"v":1}', { status: 200 });
      },
      env,
      now,
    })(init({ [WORKER_CONFIG_PROJECT]: 'demo', [WORKER_CONFIG_PARTICIPANT]: 'anna' }));
    expect(side.env).toBe(env);
    expect(side.clock.now()).toBe('2026-09-30T10:00:00.000Z');
    // the worker decodes the page itself; a body that is not a page is a typed protocol error, not garbage in the store
    await expect(side.transport.fetchPage({ since: 0, scope: '', v: 1 })).rejects.toThrow();
    expect(seen[0]).toMatch(/^\/api\/p\/demo\/sync\?since=0&scope=&v=1&limit=\d+$/);
  });

  it('refuses to start without a project', () => {
    const factory = createWorkerSide({ fetch: async () => new Response(''), env, now });
    expect(() => factory(init({}))).toThrow(/without a project/);
    expect(() => factory(init({ [WORKER_CONFIG_PROJECT]: '' }))).toThrow(/without a project/);
    expect(() => factory(init({ [WORKER_CONFIG_PROJECT]: 'demo' }))).toThrow(/without a participant/);
  });
});
