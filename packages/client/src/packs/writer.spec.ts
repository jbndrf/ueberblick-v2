// WP-650: the Safari write path. OPFS `createWritable` is missing on a Safari main thread, so the bytes are written by
// a small dedicated worker through a sync access handle, behind the unchanged PackStorage port.
import { describe, expect, it } from 'vitest';
import { bytesOf } from './fake-server.testing';
import { opfsPackStorage, type DirHandle } from './storage-opfs';
import { mainThreadCanWrite } from './writer-detect';
import { serveWriter, type SyncDirHandle } from './writer-serve';
import { workerPackWriter } from './writer-client';
import type { WriterPort } from './writer-protocol';

type Handle = Awaited<ReturnType<SyncDirHandle['getFileHandle']>>;

/** An OPFS made of maps: files are byte arrays; a file has `getFile` (reads) and `createSyncAccessHandle` (writes). */
function fakeOpfs() {
  const files = new Map<string, Uint8Array>();
  let live = 0;
  const file = (key: string): Handle => ({
    getFile: async () => {
      const b = files.get(key) ?? new Uint8Array();
      return {
        size: b.length,
        text: async () => new TextDecoder().decode(b),
        slice: (a: number, z: number) => new Blob([b.slice(a, z)]),
      };
    },
    createWritable: () => Promise.reject(new Error('createWritable is not available here')),
    createSyncAccessHandle: async () => {
      live += 1;
      return {
        write(buf: Uint8Array, o: { at: number }) {
          const cur = files.get(key) ?? new Uint8Array();
          const next = new Uint8Array(Math.max(cur.length, o.at + buf.length));
          next.set(cur);
          next.set(buf, o.at);
          files.set(key, next);
          return buf.length;
        },
        truncate(n: number) {
          const cur = files.get(key) ?? new Uint8Array();
          const next = new Uint8Array(n);
          next.set(cur.subarray(0, n));
          files.set(key, next);
        },
        flush() {},
        close() {
          live -= 1;
        },
      };
    },
  });
  const dir = (): SyncDirHandle & DirHandle => ({
    async getDirectoryHandle() {
      return dir();
    },
    async getFileHandle(name, o) {
      if (!files.has(name)) {
        if (o?.create !== true) throw Object.assign(new Error('nf'), { name: 'NotFoundError' });
        files.set(name, new Uint8Array());
      }
      return file(name);
    },
    async removeEntry(name) {
      files.delete(name);
    },
    async *entries() {
      for (const k of files.keys()) yield [k, { kind: 'file' } as never];
    },
  });
  return { root: dir(), files, live: () => live };
}

/** A worker port pair in one thread: what the client posts reaches `serveWriter`, replies come back. */
function channel(root: SyncDirHandle): WriterPort {
  let toClient: ((e: { data: unknown }) => void) | null = null;
  let toServer: ((e: { data: unknown }) => void) | null = null;
  const server: WriterPort = {
    postMessage: (m) => queueMicrotask(() => toClient?.({ data: m })),
    set onmessage(f) {
      toServer = f;
    },
    get onmessage() {
      return toServer;
    },
  };
  const client: WriterPort = {
    postMessage: (m) => queueMicrotask(() => toServer?.({ data: m })),
    set onmessage(f) {
      toClient = f;
    },
    get onmessage() {
      return toClient;
    },
  };
  serveWriter(server, async () => root);
  return client;
}

describe('the Safari writer', () => {
  it('writes a layer file in chunks and a resume continues at the given offset', async () => {
    const opfs = fakeOpfs();
    const storage = opfsPackStorage(async () => opfs.root, workerPackWriter(channel(opfs.root)));
    const a = bytesOf(300, 1);
    const w = await storage.open('h1/osm.pmtiles', 0);
    await w.write(a.subarray(0, 100));
    await w.write(a.subarray(100, 200));
    await w.close();
    expect(await storage.size('h1/osm.pmtiles')).toBe(200);
    const again = await storage.open('h1/osm.pmtiles', 200); // resume
    await again.write(a.subarray(200));
    await again.close();
    expect(opfs.files.get('osm.pmtiles')).toEqual(a);
    expect(opfs.live()).toBe(0); // every sync handle is closed
  });

  it('cuts the file to `at` when it opens (a restart that found no Range support)', async () => {
    const opfs = fakeOpfs();
    const storage = opfsPackStorage(async () => opfs.root, workerPackWriter(channel(opfs.root)));
    const w = await storage.open('h/x.pmtiles', 0);
    await w.write(bytesOf(50, 1));
    await w.close();
    const w2 = await storage.open('h/x.pmtiles', 10);
    await w2.write(bytesOf(5, 2));
    await w2.close();
    expect(await storage.size('h/x.pmtiles')).toBe(15);
  });

  it('writes the index text through the worker too, and a shorter text leaves no tail', async () => {
    const opfs = fakeOpfs();
    const storage = opfsPackStorage(async () => opfs.root, workerPackWriter(channel(opfs.root)));
    await storage.writeText('index.json', '{"packs":{}}');
    expect(await storage.readText('index.json')).toBe('{"packs":{}}');
    await storage.writeText('index.json', '{}');
    expect(await storage.readText('index.json')).toBe('{}');
  });

  it('a failing write rejects with the reason, and closing still releases the handle', async () => {
    const opfs = fakeOpfs();
    let closed = 0;
    const broken: SyncDirHandle = {
      ...opfs.root,
      getDirectoryHandle: async () => broken,
      getFileHandle: async () => ({
        getFile: async () => ({ size: 0, text: async () => '', slice: () => new Blob([]) }),
        createWritable: () => Promise.reject(new Error('no')),
        createSyncAccessHandle: async () => ({
          write(): number {
            throw new Error('QuotaExceededError');
          },
          truncate() {},
          flush() {},
          close() {
            closed += 1;
          },
        }),
      }),
    };
    const storage = opfsPackStorage(async () => broken, workerPackWriter(channel(broken)));
    const w = await storage.open('h/x.pmtiles', 0);
    await expect(w.write(bytesOf(10, 1))).rejects.toThrow('QuotaExceededError');
    await w.close();
    expect(closed).toBe(1);
  });

  it('knows when the main thread cannot write', () => {
    expect(mainThreadCanWrite({ FileSystemFileHandle: { prototype: { createWritable() {} } } })).toBe(true);
    expect(mainThreadCanWrite({ FileSystemFileHandle: { prototype: {} } })).toBe(false); // Safari
    expect(mainThreadCanWrite({})).toBe(true); // no File System API at all: `supported` is false anyway
  });
});
