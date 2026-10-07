import { describe, expect, it, vi } from 'vitest';
import { cursorAt, fakeEnv, feature, memoryMarker, rows } from './test-env';
import type { IdbDatabase } from './idb-types';
import type { MemoryIndex } from './memory';
import type * as hydrateModule from './hydrate';

/** Every hydrate waits for the test to open its gate first, so a re-read can be held half done. */
const gate = vi.hoisted(() => ({ wait: undefined as Promise<void> | undefined }));
vi.mock('./hydrate', async (importOriginal) => {
  const real = await importOriginal<typeof hydrateModule>();
  return {
    ...real,
    hydrate: async (db: IdbDatabase, mem: MemoryIndex) => {
      await gate.wait;
      return real.hydrate(db, mem);
    },
  };
});
const { openCacheWriterStore, openReplicaStore } = await import('./open');

describe('a replica re-reading the database', () => {
  it('reports the page in flight until the cursor is back, never settled without one', async () => {
    const env = fakeEnv();
    const options = { env, marker: memoryMarker() };
    const writer = await openCacheWriterStore('p1-a', options);
    await writer.applyPage(rows({ features: [feature(1, 1), feature(2, 1)] }), cursorAt(7));
    const replica = await openReplicaStore('p1-a', options);
    expect(replica.cursor()).toMatchObject({ cursor: 7 });
    expect(replica.pageInFlight()).toBe(false);

    let open!: () => void;
    gate.wait = new Promise<void>((resolve) => (open = resolve));
    const reloaded: boolean[] = [];
    replica.onChange((c) => {
      if (c.kind === 'reloaded') reloaded.push(replica.pageInFlight());
    });
    const reread = replica.rehydrate();
    // the mirror was dropped: no cursor yet, so the store must not look settled
    expect(replica.cursor()).toBeUndefined();
    expect(replica.pageInFlight()).toBe(true);
    await Promise.resolve();
    expect(replica.pageInFlight()).toBe(true);

    gate.wait = undefined;
    open();
    await reread;
    expect(replica.cursor()).toMatchObject({ cursor: 7 });
    expect(replica.pageInFlight()).toBe(false);
    // a reader woken by the `reloaded` notice already sees a settled store
    expect(reloaded).toEqual([false]);
    replica.close();
    writer.close();
  });

  it('a failed re-read does not leave the page in flight for good', async () => {
    const env = fakeEnv();
    const replica = await openReplicaStore('p1-b', { env, marker: memoryMarker() });
    gate.wait = Promise.reject(new Error('read failed'));
    gate.wait.catch(() => undefined);
    await expect(replica.rehydrate()).rejects.toThrow('read failed');
    gate.wait = undefined;
    expect(replica.pageInFlight()).toBe(false);
    replica.close();
  });
});
