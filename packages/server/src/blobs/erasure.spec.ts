// WP-142: blob bytes are deleted after commit; a crash between commit and delete is finished by a restart.
import { mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createStore } from '../store/run';
import { build, setup } from '../store/run/testkit';
import { eraseRun, erasureTemplate, mia } from '../store/run/erasure.testkit';
import { createBlobs, createBlobSweeper, fileBlobStore } from './index';
import { createBlobUploads } from '../store/blobs/uploads';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
async function* bytes(b: Buffer): AsyncGenerator<Uint8Array> {
  yield b;
}
const PHOTO = Buffer.from('personal photo');

async function world() {
  const dir = mkdtempSync(join(tmpdir(), 'ub-erase-'));
  dirs.push(dir);
  const c = setup({ config: build(erasureTemplate()) });
  const store = fileBlobStore(dir);
  const blobs = createBlobs({ db: c.db, store, clock: { now: () => 'x' } });
  const sha = createHash('sha256').update(PHOTO).digest('hex');
  await blobs.put(bytes(PHOTO), 'image/jpeg');
  createBlobUploads(c.db, { now: () => 'x' }).record(mia, sha);
  c.store.submit(
    c.run('melden', mia, { kategorie: 'x', foto: [{ sha256: sha, name: 'a.jpg', mime: 'image/jpeg' }] }),
  );
  return { c, store, blobs, sha, run: eraseRun(c) };
}

describe('BlobStore.delete', () => {
  it('removes the bytes and is idempotent, also for ids that never existed', async () => {
    const { store, sha } = await world();
    expect(store.has(sha)).toBe(true);
    await store.delete([sha, 'b'.repeat(64)]);
    expect(store.has(sha)).toBe(false);
    await expect(store.delete([sha])).resolves.toBeUndefined();
  });

  it('rejects an id that is not a sha256 and deletes nothing', async () => {
    const { store, sha } = await world();
    await expect(store.delete([sha, '../x'])).rejects.toThrow(/invalid sha256/);
    expect(store.has(sha)).toBe(true);
  });
});

describe('an erasure run deletes blob bytes after commit', () => {
  it('bytes survive until the callback deletes them, then are gone', async () => {
    const { c, store, sha, run } = await world();
    const pending: Promise<void>[] = [];
    const s = createStore(c.db, {
      ...c.deps,
      onOrphanedBlobs: (ids) => void pending.push(store.delete(ids)),
    });
    expect(store.has(sha)).toBe(true);
    s.submit(run);
    await Promise.all(pending);
    expect(store.has(sha)).toBe(false);
  });

  it('a rolled-back erasure leaves the bytes', async () => {
    const { c, store, sha, run } = await world();
    const s = createStore(c.db, {
      ...c.deps,
      erasure: {
        erase: () => {
          throw new Error('x');
        },
      },
      onOrphanedBlobs: (ids) => void store.delete(ids),
    });
    expect(() => s.submit(run)).toThrow('x');
    expect(store.has(sha)).toBe(true);
  });

  it('crash between commit and delete: a restart sweeper finishes it', async () => {
    const { c, store, sha, run } = await world();
    // The process dies right after commit: nothing deletes the bytes.
    const s = createStore(c.db, {
      ...c.deps,
      onOrphanedBlobs: () => {
        throw new Error('process died');
      },
    });
    expect(s.submit(run).outcome).toBe('accepted'); // WP-842: the failed hook is logged, the run stays accepted
    expect(c.logs.only('run.hook_failed')).toMatchObject([{ hook: 'orphans', code: 'Error' }]);
    expect(store.has(sha)).toBe(true); // bytes still there, the database already erased
    expect(c.db.prepare('SELECT * FROM blobs').all()).toEqual([]);

    const restart = createBlobSweeper({ db: c.db, store });
    expect(restart.pending()).toEqual([sha]);
    expect(await restart.sweep()).toEqual([sha]);
    expect(store.has(sha)).toBe(false);
    expect(restart.pending()).toEqual([]);
    expect(await restart.sweep()).toEqual([]); // idempotent
  });

  it('the sweeper never touches a blob that was uploaded again after the erasure', async () => {
    const { c, store, blobs, sha, run } = await world();
    createStore(c.db, c.deps).submit(run);
    await blobs.put(bytes(PHOTO), 'image/jpeg'); // same bytes, new blob row
    const sweeper = createBlobSweeper({ db: c.db, store });
    expect(sweeper.pending()).toEqual([]);
    await sweeper.sweep();
    expect(store.has(sha)).toBe(true);
  });
});
