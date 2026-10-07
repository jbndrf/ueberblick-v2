// WP-668: the .ubpack file (B-017): encode then decode round-trips, refusals keep the old pack, import streams.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bytesOf, fakePack, fakeServer } from './fake-server.testing';
import { createPackManager } from './manager';
import { memoryPackStorage } from './storage-memory';

const url = (hash: string, layer: string): string => `/api/p/demo/packs/${hash}/${layer}.pmtiles`;
const A = bytesOf(1000, 1);
const B = bytesOf(700, 2);

/** A device that holds pack "innen" (downloaded from the fake server), and a second empty device. */
async function twoDevices() {
  const p = fakePack('innen', 'h1', [
    { layer: 'osm', bytes: A },
    { layer: 'flur', bytes: B },
  ]);
  const server = fakeServer([p], { [url('h1', 'osm')]: A, [url('h1', 'flur')]: B });
  const fromStorage = memoryPackStorage();
  const from = createPackManager({ storage: fromStorage, transport: server });
  await from.sync();
  const storage = memoryPackStorage();
  const to = createPackManager({ storage, transport: server });
  await to.load();
  return { p, server, from, fromStorage, to, storage };
}

type Json = Record<string, unknown>;
/** The same file with its manifest changed by `edit` (the length prefix follows). */
async function withManifest(blob: Blob, edit: (m: Json) => void): Promise<Blob> {
  const len = new DataView(await blob.slice(4, 8).arrayBuffer()).getUint32(0, true);
  const m = JSON.parse(await blob.slice(8, 8 + len).text()) as Json;
  edit(m);
  const json = new TextEncoder().encode(JSON.stringify(m));
  const head = new Uint8Array(8);
  head.set(new TextEncoder().encode('UBPK'), 0);
  new DataView(head.buffer).setUint32(4, json.length, true);
  return new Blob([head, json, blob.slice(8 + len)]);
}

/** The file as a source of chunks of `step` bytes (what a file stream gives). */
async function* chunked(blob: Blob, step: number): AsyncGenerator<Uint8Array> {
  const all = new Uint8Array(await blob.arrayBuffer());
  for (let o = 0; o < all.length; o += step) yield all.subarray(o, o + step);
}

describe('pack file', () => {
  it('exports a stored pack as UBPK | length | manifest | layers and imports it on another device', async () => {
    const { from, to, p } = await twoDevices();
    const file = await from.packFile('innen');
    expect(file?.filename).toBe('innen.ubpack');
    const bytes = new Uint8Array((await file?.blob.arrayBuffer()) ?? new ArrayBuffer(0));
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('UBPK');
    const r = await to.importPack(chunked(file?.blob ?? new Blob(), 100));
    expect(r).toEqual({ ok: true, key: 'innen', tiles: 20 });
    expect(to.hasLayer('osm')).toBe(true);
    expect(to.progress.get()['innen']?.state).toBe('ready');
    const [osm] = await to.files.layerFiles('osm');
    expect(await osm?.read(0, 1000)).toEqual(A);
    expect((await to.counts()).totals.bytes).toBe(p.bytes);
  });

  it('round-trips any layer bytes and any chunking (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.uint8Array({ minLength: 1, maxLength: 300 }), { minLength: 1, maxLength: 4 }),
        fc.integer({ min: 1, max: 97 }),
        async (layers, step) => {
          const entry = fakePack(
            'k',
            'hh',
            layers.map((bytes, i) => ({ layer: `l${i}`, bytes })),
          );
          const contents = Object.fromEntries(entry.layers.map((l, i) => [l.url, layers[i] ?? A]));
          const server = fakeServer([entry], contents);
          const a = createPackManager({ storage: memoryPackStorage(), transport: server });
          await a.sync();
          const b = createPackManager({ storage: memoryPackStorage(), transport: server });
          const r = await b.importPack(chunked((await a.packFile('k'))?.blob ?? new Blob(), step));
          expect(r.ok).toBe(true);
          for (const [i, bytes] of layers.entries()) {
            const [f] = await b.files.layerFiles(`l${i}`);
            expect(await f?.read(0, bytes.length)).toEqual(bytes);
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  it('refuses a file that is not a pack, a truncated file and a corrupt layer, and leaves no files', async () => {
    const { from, to, storage } = await twoDevices();
    const before = new Map(storage.files);
    const blob = (await from.packFile('innen'))?.blob ?? new Blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());

    expect(await to.importPack(chunked(new Blob(['not a pack at all']), 5))).toMatchObject({
      ok: false,
      kind: 'not_a_pack',
    });
    expect(await to.importPack(chunked(blob.slice(0, bytes.length - 10), 64))).toMatchObject({
      ok: false,
      kind: 'truncated',
    });
    const flipped = bytes.slice();
    flipped[flipped.length - 5] = (flipped[flipped.length - 5] ?? 0) ^ 255;
    expect(await to.importPack(chunked(new Blob([flipped]), 64))).toMatchObject({
      ok: false,
      kind: 'sha256_mismatch',
    });
    expect(await to.importPack(chunked(new Blob([bytes, 'x']), 64))).toMatchObject({
      ok: false,
      kind: 'trailing_bytes',
    });

    expect(new Map(storage.files)).toEqual(before);
    expect(to.progress.get()['innen']).toBeUndefined();
  });

  it('a corrupt file of a NEW version leaves the device without its files and the old pack in place', async () => {
    const { from, p, fromStorage, server } = await twoDevices();
    const newer = fakePack('innen', 'h2', [{ layer: 'osm', bytes: B }]);
    server.manifestNow = { packs: [newer] };
    server.files.set(newer.layers[0]?.url ?? '', B);
    const dev = createPackManager({ storage: memoryPackStorage(), transport: server });
    await dev.sync();
    const bad = new Uint8Array(await ((await dev.packFile('innen'))?.blob ?? new Blob()).arrayBuffer());
    bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 1;
    const before = new Map(fromStorage.files);
    expect(await from.importPack(chunked(new Blob([bad]), 64))).toMatchObject({ ok: false });
    expect(new Map(fromStorage.files)).toEqual(before);
    expect((await from.counts()).totals.bytes).toBe(p.bytes);
  });

  it('refuses a pack the project does not list, but takes any pack when the device never saw a manifest', async () => {
    const { from } = await twoDevices();
    const file = (await from.packFile('innen'))?.blob ?? new Blob();
    const other = fakeServer([fakePack('anders', 'h9', [{ layer: 'osm', bytes: A }])], {});
    const known = createPackManager({ storage: memoryPackStorage(), transport: other });
    await known.refresh();
    expect(await known.importPack(chunked(file, 64))).toMatchObject({
      ok: false,
      kind: 'wrong_project',
    });
    const fresh = createPackManager({ storage: memoryPackStorage(), transport: fakeServer([], {}) });
    expect((await fresh.importPack(chunked(file, 64))).ok).toBe(true);
  });

  it('refuses names that could leave the pack directory', async () => {
    const { from, to } = await twoDevices();
    const blob = (await from.packFile('innen'))?.blob ?? new Blob();
    const evil = await withManifest(blob, (m) => (m['pack'] = { ...(m['pack'] as Json), hash: '../x' }));
    expect(await to.importPack(chunked(evil, 64))).toMatchObject({ ok: false, kind: 'unsafe_name' });
  });

  it('a later manifest refresh treats an imported pack like a downloaded one: same hash, no download', async () => {
    const { from, to, server } = await twoDevices();
    await to.importPack(chunked((await from.packFile('innen'))?.blob ?? new Blob(), 64));
    const requests = server.requests.length;
    await to.sync();
    expect(server.requests.length).toBe(requests);
    expect(to.progress.get()['innen']?.state).toBe('ready');
  });

  it('importing a pack the device already holds stops after the manifest', async () => {
    const { from, to } = await twoDevices();
    const blob = (await from.packFile('innen'))?.blob ?? new Blob();
    await to.importPack(chunked(blob, 64));
    let pulled = 0;
    async function* spy(): AsyncGenerator<Uint8Array> {
      for await (const c of chunked(blob, 64)) {
        pulled += c.length;
        yield c;
      }
    }
    expect((await to.importPack(spy())).ok).toBe(true);
    expect(pulled).toBeLessThan(blob.size);
  });

  it('streams: export reads no layer into memory, import writes in source-sized pieces', async () => {
    const { from, fromStorage, to, storage } = await twoDevices();
    let reads = 0;
    const read = fromStorage.read.bind(fromStorage);
    fromStorage.read = async (...a) => {
      reads += 1;
      return read(...a);
    };
    const blob = (await from.packFile('innen'))?.blob ?? new Blob();
    expect(reads).toBe(0);
    const sizes: number[] = [];
    const open = storage.open.bind(storage);
    storage.open = async (path, at) => {
      const w = await open(path, at);
      return {
        write: (c) => {
          sizes.push(c.length);
          return w.write(c);
        },
        close: () => w.close(),
      };
    };
    await to.importPack(chunked(blob, 50));
    expect(Math.max(...sizes)).toBeLessThanOrEqual(50);
  });

  it('reports progress by bytes of the pack', async () => {
    const { from, to, p } = await twoDevices();
    const seen: [number, number][] = [];
    await to.importPack(chunked((await from.packFile('innen'))?.blob ?? new Blob(), 200), (d, t) =>
      seen.push([d, t]),
    );
    expect(seen.at(-1)).toEqual([p.bytes, p.bytes]);
  });

  it('a device without OPFS refuses at once, and a pack that is not stored has no file', async () => {
    const off = createPackManager({
      storage: memoryPackStorage({ supported: false }),
      transport: fakeServer([], {}),
    });
    expect(await off.importPack(chunked(new Blob(['x']), 1))).toMatchObject({
      ok: false,
      kind: 'not_supported',
    });
    expect(await off.packFile('innen')).toBeUndefined();
  });

  it('names the kind of every refusal: version, manifest, layer table, storage', async () => {
    const { from, to, storage } = await twoDevices();
    const blob = (await from.packFile('innen'))?.blob ?? new Blob();
    const kindOf = async (b: Blob) => ((await to.importPack(chunked(b, 64))) as { kind?: string }).kind;
    expect(await kindOf(await withManifest(blob, (m) => (m['version'] = 2)))).toBe('unsupported_version');
    expect(await kindOf(await withManifest(blob, (m) => (m['pack'] = {})))).toBe('bad_manifest');
    expect(await kindOf(await withManifest(blob, (m) => (m['layers'] = [])))).toBe('bad_manifest');
    expect(await kindOf(blob.slice(0, 20))).toBe('truncated');
    storage.open = async () => Promise.reject(new Error('QuotaExceededError'));
    expect(await to.importPack(chunked(blob, 64))).toMatchObject({ ok: false, kind: 'write_failed' });
  });
});
