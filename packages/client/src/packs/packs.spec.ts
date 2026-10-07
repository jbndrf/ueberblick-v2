// WP-662: offline packs on the device, against a fake manifest and a fake Range server.
import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PackProgress, PackStorage } from './contract';
import { bytesOf, fakePack, fakeServer, sha256Hex } from './fake-server.testing';
import { createPackManager } from './manager';
import { createSha256 } from './sha256';
import { fetchPackTransport } from './transport';
import { memoryPackStorage } from './storage-memory';
import { deviceOpfsStorage } from './storage-opfs';

const A = bytesOf(1000, 1);
const B = bytesOf(700, 2);
const B2 = bytesOf(900, 3);
const url = (hash: string, layer: string): string => `/api/p/demo/packs/${hash}/${layer}.pmtiles`;

function setup() {
  const storage = memoryPackStorage();
  const p1 = fakePack('innen', 'h1', [
    { layer: 'osm', bytes: A },
    { layer: 'flur', bytes: B },
  ]);
  const server = fakeServer([p1], { [url('h1', 'osm')]: A, [url('h1', 'flur')]: B });
  const manager = createPackManager({ storage, transport: server });
  return { storage, server, manager, p1 };
}

describe('sha256', () => {
  it('matches the known vectors for the empty string and "abc"', () => {
    const hex = (t: string): string => {
      const h = createSha256();
      h.update(new TextEncoder().encode(t));
      return h.hex();
    };
    expect(hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches node:crypto for any bytes and any chunking', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 400 }), fc.integer({ min: 1, max: 130 }), (bytes, step) => {
        const h = createSha256();
        for (let i = 0; i < bytes.length; i += step) h.update(bytes.subarray(i, i + step));
        expect(h.hex()).toBe(createHash('sha256').update(bytes).digest('hex'));
      }),
    );
  });
});

describe('pack manager: the manifest diff', () => {
  it('downloads a new pack, keeps unchanged ones, and deletes a pack that left the manifest', async () => {
    const { storage, server, manager, p1 } = setup();
    await manager.sync();
    expect(manager.progress.get()['innen']?.state).toBe('ready');
    expect(storage.files.get('h1/osm.pmtiles')).toEqual(A);
    const before = server.requests.length;

    await manager.sync(); // unchanged: no download
    expect(server.requests.length).toBe(before);

    const p2 = fakePack('neu', 'n1', [{ layer: 'osm', bytes: B }]);
    server.files.set(url('n1', 'osm'), B);
    server.manifestNow = { packs: [p1, p2] };
    await manager.sync();
    expect(server.requests.slice(before).map((r) => r[0])).toEqual([url('n1', 'osm')]);

    server.manifestNow = { packs: [p2] }; // innen is gone
    await manager.sync();
    expect([...storage.files.keys()]).toEqual(['n1/osm.pmtiles']);
    expect(manager.progress.get()['innen']).toBeUndefined();
    expect((await manager.counts()).totals.packs).toBe(1);
  });

  it('downloads only the changed layer of a changed pack and drops the old files after', async () => {
    const { storage, server, manager, p1 } = setup();
    await manager.sync();
    const before = server.requests.length;
    const p1b = fakePack('innen', 'h2', [
      { layer: 'osm', bytes: A }, // same sha256: kept in place
      { layer: 'flur', bytes: B2 },
    ]);
    server.files.set(url('h2', 'flur'), B2);
    server.files.set(url('h2', 'osm'), A);
    server.manifestNow = { packs: [p1b] };
    await manager.sync();
    expect(server.requests.slice(before).map((r) => r[0])).toEqual([url('h2', 'flur')]);
    expect([...storage.files.keys()].sort()).toEqual(['h1/osm.pmtiles', 'h2/flur.pmtiles']);
    const files = await manager.files.layerFiles('osm');
    expect(files.map((f) => f.id)).toEqual(['h1/osm']);
    expect(p1.hash).toBe('h1');
  });

  it('a second manager on the same storage finds the packs again (the index persists)', async () => {
    const { storage, server } = setup();
    await createPackManager({ storage, transport: server }).sync();
    const again = createPackManager({ storage, transport: server });
    await again.load();
    expect(again.progress.get()['innen']?.state).toBe('ready');
  });
});

describe('pack manager: resume and verify', () => {
  it('resumes an interrupted download by Range', async () => {
    const { storage, server, manager } = setup();
    server.cutAfter = 300;
    await manager.sync();
    expect(manager.progress.get()['innen']?.state).toBe('failed');
    expect(storage.files.get('h1/osm.pmtiles')?.length).toBe(320); // chunk-aligned cut
    await manager.sync();
    expect(manager.progress.get()['innen']?.state).toBe('ready');
    expect(server.requests.filter((r) => r[0] === url('h1', 'osm')).map((r) => r[1])).toEqual([0, 320]);
    expect(storage.files.get('h1/osm.pmtiles')).toEqual(A);
  });

  it('restarts from zero when the server ignores Range', async () => {
    const { storage, server, manager } = setup();
    server.cutAfter = 300;
    await manager.sync();
    server.ignoreRange = true;
    await manager.sync();
    expect(manager.progress.get()['innen']?.state).toBe('ready');
    expect(storage.files.get('h1/osm.pmtiles')).toEqual(A);
  });

  it('fails the pack with a reason on a sha256 mismatch and keeps the old version', async () => {
    const { storage, server, manager } = setup();
    await manager.sync();
    const bad = fakePack('innen', 'h2', [{ layer: 'osm', bytes: B2, sha256: sha256Hex(A) }]);
    server.files.set(url('h2', 'osm'), B2);
    server.manifestNow = { packs: [bad] };
    await manager.sync();
    const p = manager.progress.get()['innen'] as PackProgress;
    expect(p.state).toBe('failed');
    expect(p.reason).toContain('sha256');
    expect(storage.files.has('h2/osm.pmtiles')).toBe(false);
    expect(storage.files.get('h1/osm.pmtiles')).toEqual(A);
    expect((await manager.files.layerFiles('osm')).map((f) => f.id)).toEqual(['h1/osm']);
    expect((await manager.counts()).packs.map((c) => c.key)).toEqual(['innen']);
  });
});

describe('pack manager: the progress signal', () => {
  it('goes absent, queued, downloading, ready', async () => {
    const { manager, p1 } = setup();
    const seen: string[] = [];
    let last: PackProgress | undefined;
    manager.progress.subscribe((all) => {
      const s = all['innen'];
      if (s !== undefined && s !== last) {
        last = s;
        if (seen[seen.length - 1] !== s.state) seen.push(s.state);
      }
    });
    await manager.refresh();
    expect(seen).toEqual(['absent']);
    await manager.download([p1.key]);
    expect(seen).toEqual(['absent', 'queued', 'downloading', 'ready']);
    expect(manager.progress.get()['innen']).toEqual({ state: 'ready', bytes_done: 1700, bytes_total: 1700 });
  });

  it('reports bytes while downloading and goes to failed with a reason when the network drops', async () => {
    const { server, manager } = setup();
    const done: number[] = [];
    manager.progress.subscribe((all) => {
      if (all['innen']?.state === 'downloading') done.push(all['innen'].bytes_done);
    });
    server.cutAfter = 200;
    await manager.sync();
    expect(done.length).toBeGreaterThan(1);
    expect(done).toEqual([...done].sort((a, b) => a - b));
    expect(manager.progress.get()['innen']).toMatchObject({ state: 'failed', reason: 'connection lost' });
  });

  it('refresh offline changes nothing and says so', async () => {
    const { server, manager } = setup();
    await manager.sync();
    server.offline = true;
    expect((await manager.refresh()).ok).toBe(false);
    expect(manager.progress.get()['innen']?.state).toBe('ready');
  });
});

describe('storage counts', () => {
  it('returns bytes, tiles and layers per pack, and totals', async () => {
    const { manager } = setup();
    await manager.sync();
    expect(await manager.counts()).toEqual({
      packs: [
        { key: 'innen', label: 'innen', bytes: 1700, tiles: 20, layers: 2, built_at: '2026-10-01T00:00:00Z' },
      ],
      totals: { packs: 1, bytes: 1700, tiles: 20 },
    });
  });
});

describe('no OPFS', () => {
  it('reports "not supported" and does nothing', async () => {
    const storage: PackStorage = deviceOpfsStorage({}, { project: 'demo', participant: 'u' });
    const server = fakeServer([], {});
    const manager = createPackManager({ storage, transport: server });
    expect(manager.supported).toBe(false);
    expect(await manager.refresh()).toEqual({ ok: false, reason: 'not supported' });
    expect(await manager.files.layerFiles('osm')).toEqual([]);
    expect((await manager.counts()).totals).toEqual({ packs: 0, bytes: 0, tiles: 0 });
  });
});

describe('pack manager: remove and hasLayer (WP-650)', () => {
  it('hasLayer answers from the ready packs at once after load, and remove forgets a pack and its files', async () => {
    const { storage, manager } = setup();
    await manager.sync();
    expect(manager.hasLayer('osm')).toBe(true);
    expect(manager.hasLayer('nope')).toBe(false);
    const fresh = createPackManager({ storage, transport: setup().server });
    expect(fresh.hasLayer('osm')).toBe(false); // not loaded yet
    await fresh.load();
    expect(fresh.hasLayer('osm')).toBe(true);

    await manager.remove(['innen']);
    expect(manager.hasLayer('osm')).toBe(false);
    expect([...storage.files.keys()]).toEqual([]);
    expect((await manager.counts()).totals.packs).toBe(0);
    expect(manager.progress.get()['innen']?.state).toBe('absent'); // the server still lists it: downloadable again
    expect(JSON.parse(storage.texts.get('index.json') ?? '{}').packs).toEqual({});
  });

  it('remove of a pack that is not there does nothing, and a removed pack downloads again', async () => {
    const { manager } = setup();
    await manager.sync();
    await manager.remove(['unknown']);
    expect(manager.progress.get()['innen']?.state).toBe('ready');
    await manager.remove(['innen']);
    await manager.download(['innen']);
    expect(manager.progress.get()['innen']?.state).toBe('ready');
  });
});

describe('the manifest from the server is decoded (WP-650)', () => {
  const fetchOf = (json: unknown) => async () => ({
    ok: true,
    status: 200,
    body: null,
    json: async () => json,
  });

  it('a valid answer is the manifest', async () => {
    const p1 = fakePack('innen', 'h1', [{ layer: 'osm', bytes: A }]);
    const manifest = await fetchPackTransport('demo', fetchOf({ packs: [p1], extra: 1 })).manifest();
    expect(manifest.packs.map((p) => p.key)).toEqual(['innen']);
  });

  it('a bad answer fails the refresh with the reason and holds no pack', async () => {
    const p1 = { ...fakePack('innen', 'h1', [{ layer: 'osm', bytes: A }]), bytes: 'many' };
    const manager = createPackManager({
      storage: memoryPackStorage(),
      transport: fetchPackTransport('demo', fetchOf({ packs: [p1] })),
    });
    const r = await manager.refresh();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain('packs[0].bytes');
    expect(manager.progress.get()).toEqual({});
  });
});
