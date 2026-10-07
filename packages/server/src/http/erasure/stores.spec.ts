// WP-142.1/142.2: the project store deletes orphaned blob bytes after the commit of an erasure run and sweeps at open.
import { afterEach, describe, expect, it } from 'vitest';
import { createProjectStores } from '../shared';
import { PHOTO_SHA, cleanup, world } from './testkit';

afterEach(cleanup);
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

describe('project stores and blob bytes', () => {
  it('a run of the erasure task through a project store deletes the orphaned bytes after the commit', async () => {
    const w = await world();
    await w.seedReport();
    expect(w.blobStore.has(PHOTO_SHA)).toBe(true);
    expect(w.store('trees').submit(w.erase()).outcome).toBe('accepted');
    expect(w.blobStore.has(PHOTO_SHA)).toBe(false);
  });

  it('a store opened after a crash between commit and delete sweeps the rest', async () => {
    const w = await world();
    await w.seedReport();
    // The process dies after the commit: the delete never happens.
    const dying = createProjectStores(w.withBytes({ ...w.blobStore, delete: async () => undefined }));
    expect(dying('trees').submit(w.erase()).outcome).toBe('accepted');
    expect(w.blobStore.has(PHOTO_SHA)).toBe(true);
    // Restart: opening the project's store finishes it.
    createProjectStores(w.stores)('trees');
    await settle();
    expect(w.blobStore.has(PHOTO_SHA)).toBe(false);
  });

  it('a failing byte delete is reported and does not fail the erasure', async () => {
    const w = await world();
    await w.seedReport();
    const failing = createProjectStores(
      w.withBytes({ ...w.blobStore, delete: () => Promise.reject(new Error('disk')) }),
    );
    expect(failing('trees').submit(w.erase()).outcome).toBe('accepted');
    await settle();
    expect(w.errors.length).toBeGreaterThan(0);
    expect(w.blobStore.has(PHOTO_SHA)).toBe(true); // the next start's sweeper finishes it
  });
});
