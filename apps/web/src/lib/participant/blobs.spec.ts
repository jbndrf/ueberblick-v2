import { describe, expect, it } from 'vitest';
import { createPendingBlobs, withoutFiles } from './blobs';
import { wipeParticipantDevice } from './wipe';

describe('pending blobs', () => {
  it('peek returns a held blob with its mime, and nothing for an unknown hash', async () => {
    const pending = createPendingBlobs();
    await pending.put('d'.repeat(64), new Blob([new Uint8Array([1])]), 'image/jpeg');
    expect(pending.peek('d'.repeat(64))?.mime).toBe('image/jpeg');
    expect(pending.peek('e'.repeat(64))).toBeUndefined();
  });

  it('take returns the held bytes with the given mime type', async () => {
    const sha256 = 'c'.repeat(64);
    const pending = createPendingBlobs();
    await pending.put(sha256, new Blob([new Uint8Array([9, 8])]), 'image/webp');
    const taken = await pending.take({ foto: { sha256 } });
    expect(taken).toEqual([{ sha256, bytes: new Uint8Array([9, 8]), mime: 'image/webp' }]);
  });
});

describe('draft photo bytes (WP-811)', () => {
  const sha = 'a'.repeat(64);
  const draft = { foto: { sha256: sha } };
  const bytes = () => new Blob([new Uint8Array([4, 5, 6])]);

  async function setup() {
    const { IDBFactory } = await import('fake-indexeddb');
    const factory = new IDBFactory();
    const { createIdbBlobShelf } = await import('./blob-shelf');
    const env = { factory, keyRange: undefined as never } as never;
    return { factory, shelf: () => createIdbBlobShelf(env, 'demo', 'vera') };
  }

  it('a persisted draft photo is restored by a fresh module; forget deletes it', async () => {
    const { shelf } = await setup();
    const first = createPendingBlobs(shelf());
    await first.put(sha, bytes(), 'image/jpeg');
    await first.persist('k1', draft);

    const reloaded = createPendingBlobs(shelf());
    expect(reloaded.peek(sha)).toBeUndefined();
    await reloaded.restore(draft);
    expect(reloaded.peek(sha)?.mime).toBe('image/jpeg');
    expect(await reloaded.take(draft)).toEqual([
      { sha256: sha, bytes: new Uint8Array([4, 5, 6]), mime: 'image/jpeg' },
    ]);

    await reloaded.forget('k1', draft);
    const after = createPendingBlobs(shelf());
    await after.restore(draft);
    expect(after.peek(sha)).toBeUndefined();
  });

  it('one photo in two drafts: discarding one keeps the bytes, discarding both removes them', async () => {
    const { shelf } = await setup();
    const a = createPendingBlobs(shelf());
    await a.put(sha, bytes(), 'image/jpeg');
    await a.persist('A', draft);
    await a.persist('B', draft);
    await a.forget('A', draft);
    const afterA = createPendingBlobs(shelf());
    expect(await afterA.restore(draft)).toEqual([]);
    await afterA.forget('B', draft);
    const afterB = createPendingBlobs(shelf());
    expect(await afterB.restore(draft)).toEqual([sha]);
  });

  it('sweep removes bytes whose drafts are gone and keeps the others', async () => {
    const { shelf } = await setup();
    const other = 'e'.repeat(64);
    const a = createPendingBlobs(shelf());
    await a.put(sha, bytes(), 'image/jpeg');
    await a.put(other, bytes(), 'image/jpeg');
    await a.persist('gone', draft);
    await a.persist('gone', { f: { sha256: other } });
    await a.persist('live', { f: { sha256: other } });
    await createPendingBlobs(shelf()).sweep((k) => k === 'live');
    const after = createPendingBlobs(shelf());
    expect(await after.restore({ a: { sha256: sha }, b: { sha256: other } })).toEqual([sha]);
  });

  it('bytes that were never saved with a draft are not kept', async () => {
    const { shelf } = await setup();
    await createPendingBlobs(shelf()).put(sha, bytes(), 'image/jpeg');
    const reloaded = createPendingBlobs(shelf());
    await reloaded.restore(draft);
    expect(reloaded.peek(sha)).toBeUndefined();
  });

  it('restore reports the hashes it could not bring back', async () => {
    const { shelf } = await setup();
    const first = createPendingBlobs(shelf());
    await first.put(sha, bytes(), 'image/jpeg');
    await first.persist('k1', draft);
    const lost = 'f'.repeat(64);
    const reloaded = createPendingBlobs(shelf());
    expect(await reloaded.restore({ a: { sha256: sha }, b: { sha256: lost } })).toEqual([lost]);
  });

  it('a wipe with the shelf still open deletes the stored bytes', async () => {
    const { factory, shelf } = await setup();
    const open = createPendingBlobs(shelf());
    await open.put(sha, bytes(), 'image/jpeg');
    await open.persist('k1', draft);
    const storage = { length: 0, key: () => null, removeItem: () => undefined } as unknown as Storage;
    await wipeParticipantDevice(
      { project: 'demo', participant: 'vera' },
      { idb: factory, storage, blockedMs: 5000 },
    );
    const after = createPendingBlobs(shelf());
    expect(await after.restore(draft)).toEqual([sha]);
  });

  it('close lets the database be deleted without waiting', async () => {
    const { factory, shelf } = await setup();
    const s = shelf();
    await s.put(sha, bytes(), 'image/jpeg', 'k1');
    s.close();
    await new Promise<void>((resolve, reject) => {
      const req = factory.deleteDatabase('ub-draftblobs:demo:vera');
      req.onblocked = () => reject(new Error('blocked'));
      req.onsuccess = () => resolve();
    });
  });
});

describe('take refuses a photo it cannot carry', () => {
  const sha = '1'.repeat(64);
  it('throws for a hash that is neither held nor stored on the device', async () => {
    await expect(createPendingBlobs().take({ foto: { sha256: sha } })).rejects.toThrow(/missing/);
  });
  it('leaves a hash out that the device already stores (resubmitted run)', async () => {
    const pending = createPendingBlobs(undefined, (h) => h === sha);
    expect(await pending.take({ foto: { sha256: sha } })).toEqual([]);
  });
  it('withoutFiles keeps other values untouched', () => {
    expect(withoutFiles({ a: 1, f: { sha256: sha } }, [sha])).toEqual({ a: 1 });
  });
});
