/**
 * Budget (docs/12): the offline pack file (WP-668, B-017). Export builds a lazy Blob (header plus the stored layer
 * files, nothing is read), so it costs O(layers) and fits one frame. Import streams the file through the incremental
 * sha256 into the store at the rate of a 4G download (at least 25 MB/s, like the server's range read), on the 4x slower
 * device factor: a 64 MB pack (two 32 MB layers) in at most 2.6 s x 4. The byte source is memory, so OPFS write latency
 * is not included (the browser measures that). Nothing is committed.
 * Run: npm test -- -c bench/vitest.config.ts pack-file
 */
import { describe, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { streamChunks } from '../../packages/client/src/packs/bundle';
import { bytesOf, fakePack, fakeServer } from '../../packages/client/src/packs/fake-server.testing';
import { createPackManager } from '../../packages/client/src/packs/manager';
import { memoryPackStorage } from '../../packages/client/src/packs/storage-memory';

const LAYER = 32 * 1024 * 1024;
const MB = 1024 * 1024;

const exportBudget = defineBudget({
  id: 'pack-file-export',
  limit: 16,
  unit: 'ms',
  derivedFrom: 'map frame: building the lazy pack file Blob fits one 16 ms frame',
  device: 'x4',
  thread: 'main',
});
const importBudget = defineBudget({
  id: 'pack-file-import-64mb',
  limit: 10_400,
  unit: 'ms',
  derivedFrom: 'pack-range-read-50mb: a pack is read at 25 MB/s or better (64 MB at 4x)',
  device: 'x4',
  thread: 'main',
});

describe('bench: offline pack file', () => {
  it('export and import of a 64 MB pack', async () => {
    const layers = [
      { layer: 'osm', bytes: bytesOf(LAYER, 1) },
      { layer: 'flur', bytes: bytesOf(LAYER, 2) },
    ];
    const entry = fakePack('innen', 'h1', layers);
    const contents = Object.fromEntries(
      entry.layers.map((l, i) => [l.url, layers[i]?.bytes ?? new Uint8Array()]),
    );
    const server = fakeServer([entry], contents);
    // A stand-in for OPFS, whose blob() is a lazy slice of the file: built once, handed out in O(1).
    const fromStorage = memoryPackStorage();
    const blobs = new Map<string, Blob>();
    fromStorage.blob = async (path) => {
      const f = fromStorage.files.get(path);
      if (f === undefined) return undefined;
      if (!blobs.has(path)) blobs.set(path, new Blob([new Uint8Array(f)]));
      return blobs.get(path)?.slice(0, f.length);
    };
    const from = createPackManager({ storage: fromStorage, transport: server });
    await from.sync();
    await from.packFile('innen'); // warm the stand-in

    const t0 = performance.now();
    const file = await from.packFile('innen');
    const exportMs = performance.now() - t0;
    if (file === undefined) throw new Error('no pack file');

    const to = createPackManager({ storage: memoryPackStorage(), transport: server });
    const t1 = performance.now();
    const r = await to.importPack(streamChunks(file.blob.stream() as ReadableStream<Uint8Array>));
    const importMs = performance.now() - t1;
    if (!r.ok) throw new Error(r.reason);
    console.log(
      `pack file ${(file.blob.size / MB).toFixed(0)} MB: export ${exportMs.toFixed(2)} ms, import ${importMs.toFixed(0)} ms (${(file.blob.size / MB / (importMs / 1000)).toFixed(0)} MB/s)`,
    );
    assertBudget(report(exportBudget, exportMs));
    assertBudget(report(importBudget, importMs));
  }, 120_000);
});
