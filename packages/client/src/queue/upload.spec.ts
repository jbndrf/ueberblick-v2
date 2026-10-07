// WP-605: the queue uploads a run's files before it sends the run, and keeps them across reloads.
import { describe, expect, it, vi } from 'vitest';
import type { FeatureId } from '@ueberblick/core/model';
import type { BlobInput, IdbEnv } from '../store';
import { fakeEnv } from '../store/test-env';
import { FakeBlobServer, IDS, befundErgaenzen, makeKit, runId } from './queue.testing';

const T: FeatureId = IDS.t_in;
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const files: BlobInput[] = [
  { sha256: A, bytes: new Uint8Array([1, 2]), mime: 'image/jpeg' },
  { sha256: B, bytes: new Uint8Array([3]), mime: 'image/png' },
];

/** A kit whose blob and run servers write into one log. */
async function kit(env = fakeEnv()) {
  const log: string[] = [];
  const blobs = new FakeBlobServer(log);
  const k = await makeKit({ env, blobs });
  const send = k.server.send.bind(k.server);
  k.server.send = async (p) => {
    log.push('send');
    return send(p);
  };
  return { k, log, blobs, env };
}

/** The bytes of one blob are gone from the store (a raw write: the store's own API keeps the bytes a run still references). */
async function loseBlob(env: IdbEnv, name: string, sha256: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const open = env.factory.open(name);
    open.onerror = () => reject(open.error ?? new Error('open failed'));
    open.onsuccess = () => {
      const tx = open.result.transaction(['blobs'], 'readwrite');
      tx.objectStore('blobs').delete(sha256);
      tx.oncomplete = () => {
        open.result.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error ?? new Error('delete failed'));
    };
  });
}

describe('upload before send', () => {
  it('uploads both files, then sends the run, with each mime', async () => {
    const { k, log, blobs } = await kit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'), files);
    await k.queue.drain();
    expect(log).toEqual([`put:${A}`, `put:${B}`, 'send']); // bytes on the device: PUT straight away, no has() probe
    expect(blobs.held.get(A)?.mime).toBe('image/jpeg');
    expect(blobs.held.get(B)?.mime).toBe('image/png');
    expect(k.queue.status().pending).toBe(0);
  });

  it('discarding a queued run removes its parked bytes (shared ones stay until the last run goes); nothing is sent', async () => {
    const { k, blobs } = await kit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'), files);
    await k.queue.enqueue(befundErgaenzen(2, T, 'B'), [files[0] as BlobInput]);
    await k.queue.discard(runId(1));
    expect(await k.store.getBlob(B)).toBeUndefined();
    expect(await k.store.getBlob(A)).toBeDefined();
    await k.queue.discard(runId(2));
    expect(await k.store.getBlob(A)).toBeUndefined();
    await k.queue.drain();
    expect(k.server.sent).toHaveLength(0);
    expect(blobs.held.size).toBe(0);
  });

  it('a file already on the server is still PUT (idempotent) without a has() call', async () => {
    const { k, log, blobs } = await kit();
    blobs.held.set(A, { bytes: new Uint8Array([1, 2]), mime: 'image/jpeg' });
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'), files);
    await k.queue.drain();
    expect(log).toEqual([`put:${A}`, `put:${B}`, 'send']);
  });

  it('bytes gone from the device but held by the server: has() answers, the run proceeds without a refusal', async () => {
    const { k, log, blobs } = await kit();
    blobs.held.set(A, { bytes: new Uint8Array([1, 2]), mime: 'image/jpeg' });
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'), [files[0] as BlobInput]);
    await loseBlob(k.env, 'q', A);
    const r = await k.queue.drain();
    expect(r.refused).toBe(0);
    expect(log).toEqual([`has:${A}`, 'send']);
  });

  it('a transient upload failure sends nothing, backs off, and the retry uploads then sends', async () => {
    const { k, log, blobs } = await kit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'), files);
    blobs.fail = new Error('offline');
    await k.queue.drain();
    expect(log).not.toContain('send');
    expect(k.queue.status()).toMatchObject({ hold: 'backoff', pending: 1 });
    blobs.fail = undefined;
    k.mono.t += 2_000;
    await k.queue.drain();
    expect(log.at(-1)).toBe('send');
    expect(k.queue.status().pending).toBe(0);
  });

  it('a retry PUTs only the files that did not arrive (WP-803)', async () => {
    const { k, log, blobs } = await kit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'), files);
    const put = blobs.put.bind(blobs);
    blobs.put = async (sha, bytes, mime) => {
      if (sha === B && !log.includes('b-failed')) {
        log.push('b-failed');
        throw new Error('offline');
      }
      return put(sha, bytes, mime);
    };
    await k.queue.drain();
    k.mono.t += 2_000;
    await k.queue.drain();
    expect(log.filter((l) => l === `put:${A}`)).toHaveLength(1);
    expect(log.filter((l) => l === `put:${B}`)).toHaveLength(1);
    expect(k.queue.status().pending).toBe(0);
  });

  it('a send that fails after the uploads does not upload again on the retry (WP-803)', async () => {
    const { k, log } = await kit();
    k.server.next = async () => ({ kind: 'transient', reason: 'down' });
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'), files);
    await k.queue.drain();
    k.server.next = undefined;
    k.mono.t += 2_000;
    await k.queue.drain();
    expect(log.filter((l) => l.startsWith('put:'))).toHaveLength(2);
    expect(k.queue.status().pending).toBe(0);
  });

  it.each([
    ['mismatch', 'blob_mismatch'],
    ['too_large', 'blob_too_large'],
  ] as const)('%s refuses the run locally and keeps the bytes', async (result, code) => {
    const { k, log, blobs } = await kit();
    blobs.putResult = result;
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'), files);
    const r = await k.queue.drain();
    expect(r.refused).toBe(1);
    expect(log).not.toContain('send');
    const row = (await k.store.readRuns())[0];
    expect(row).toMatchObject({ state: 'refused', refusal: { code } });
    expect(await k.store.getBlob(A)).toEqual(new Uint8Array([1, 2]));
    expect(row?.blobMimes[A]).toBe('image/jpeg');
  });

  it('a run whose file bytes are gone from the store is refused locally with blob_lost and never sent', async () => {
    const { k, log } = await kit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'), files);
    await loseBlob(k.env, 'q', A);
    const r = await k.queue.drain();
    expect(r.refused).toBe(1);
    expect(log).toEqual([`has:${A}`]);
    const row = (await k.store.readRuns())[0];
    expect(row).toMatchObject({ state: 'refused', refusal: { code: 'blob_lost' } });
  });

  it('after a reload the bytes and mime are still there and are uploaded', async () => {
    const first = await kit();
    await first.k.queue.enqueue(befundErgaenzen(1, T, 'A'), files);
    first.k.queue.close();
    first.k.store.close();
    const second = await kit(first.env);
    await second.k.queue.drain();
    expect(second.blobs.held.get(B)).toEqual({ bytes: new Uint8Array([3]), mime: 'image/png' });
    await vi.waitFor(() => expect(second.log).toContain('send'));
  });

  it('a resubmitted refused run keeps its mime', async () => {
    const { k, blobs } = await kit();
    blobs.putResult = 'mismatch';
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'), files);
    await k.queue.drain();
    blobs.putResult = undefined;
    await k.queue.resubmit(befundErgaenzen(1, T, 'A').id);
    await k.queue.drain();
    expect(blobs.held.get(A)?.mime).toBe('image/jpeg');
  });

  it('server refuses with blob_missing (photo lost after the PUT): "Erneut senden" uploads the file again (WP-828)', async () => {
    const { k, log, blobs } = await kit();
    k.server.script = {
      refuse: () => ({ code: 'blob_missing', message: 'file is not on the server', path: A }),
    };
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'), [files[0] as BlobInput]);
    await k.queue.drain();
    expect(await k.store.getBlob(A)).toBeDefined(); // the device keeps the bytes of a refused run
    expect((await k.store.readRuns())[0]).toMatchObject({
      state: 'refused',
      refusal: { code: 'blob_missing' },
    });
    blobs.held.clear(); // the server lost the file
    k.server.script = {};
    log.length = 0;
    expect((await k.queue.resubmit(runId(1))).ok).toBe(true);
    await vi.waitFor(() => expect(k.queue.status().awaitingPull).toBe(1));
    expect(log).toEqual([`put:${A}`, 'send']);
    expect(blobs.held.get(A)?.mime).toBe('image/jpeg');
  });
});
