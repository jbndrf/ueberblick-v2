// The device's offline packs (WP-662, contract A-032): diffs the server's manifest against the index, downloads what
// changed by Range into the store, verifies sha256, and keeps the progress signal and the storage counts.
import { PackFileError, packFileBlob, packFileName, readPackFile, safeName } from './bundle';
import type {
  PackCounts,
  PackIndex,
  PackLayerEntry,
  PackLayerFile,
  PackManifestEntry,
  PackProgress,
  PackStorage,
  PackTransport,
  PendingPack,
  Readable,
  StoredLayer,
  StoredPack,
} from './contract';
import { EMPTY_INDEX } from './contract';
import type { PackRefusal } from './refusals';
import { storageCounts } from './counts';
import { createSha256 } from './sha256';

const INDEX_PATH = 'index.json';
const HASH_CHUNK = 1 << 20;
const filePath = (hash: string, layer: string): string => `${hash}/${layer}.pmtiles`;

export interface PackManager {
  readonly supported: boolean;
  /** Per pack key. A key the server does not list and the device does not hold is not in it. */
  readonly progress: Readable<Readonly<Record<string, PackProgress>>>;
  /** Reads the index from the store. Called by the other methods; call it at start to show packs offline. */
  load(): Promise<void>;
  /** Fetches the manifest, deletes packs that left it and marks the rest ready or absent. No download. */
  refresh(): Promise<{ ok: true; packs: readonly PackManifestEntry[] } | { ok: false; reason: string }>;
  /** Downloads the named packs from the last manifest (changed layers only). Runs queue behind each other. */
  download(keys: readonly string[], signal?: AbortSignal): Promise<void>;
  /** `refresh` plus a download of every pack the manifest lists. */
  sync(signal?: AbortSignal): Promise<void>;
  /** Deletes the named packs and their files from the device. A pack the server still lists becomes `absent`: downloadable again. */
  remove(keys: readonly string[]): Promise<void>;
  /**
   * Imports a pack file (`.ubpack`, B-017) from a byte stream: every layer is written to the store and checked by its
   * sha256 as it arrives. A refused file leaves the device as it was. A ready pack is used by the map at once.
   */
  importPack(
    source: AsyncIterable<Uint8Array>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<ImportResult>;
  /** The stored pack as one file (a lazy Blob over its layer files), or undefined when the device does not hold it. */
  packFile(key: string): Promise<{ readonly filename: string; readonly blob: Blob } | undefined>;
  /** Is a layer held by a ready pack? Synchronous: true only after `load()` (the protocol routes by it). */
  hasLayer(layer: string): boolean;
  counts(): Promise<PackCounts>;
  /** What the map protocol reads: the ready files of a layer. */
  readonly files: { layerFiles(layer: string): Promise<readonly PackLayerFile[]> };
}

export type ImportResult =
  | { readonly ok: true; readonly key: string; readonly tiles: number }
  | { readonly ok: false; readonly kind: PackRefusal; readonly reason: string };

export interface PackManagerDeps {
  readonly storage: PackStorage;
  readonly transport: PackTransport;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createPackManager(deps: PackManagerDeps): PackManager {
  const { storage, transport } = deps;
  let index: PackIndex = EMPTY_INDEX;
  let loaded: Promise<void> | undefined;
  let manifest: readonly PackManifestEntry[] = [];
  /** A manifest answer was seen: only then can an imported pack be checked against the project. */
  let manifestSeen = false;
  let state: Record<string, PackProgress> = {};
  let job: Promise<unknown> = Promise.resolve();
  const listeners = new Set<(v: Readonly<Record<string, PackProgress>>) => void>();

  const set = (key: string, p: PackProgress | undefined): void => {
    const rest = Object.fromEntries(Object.entries(state).filter(([k]) => k !== key));
    state = p === undefined ? rest : { ...rest, [key]: p };
    for (const l of listeners) l(state);
  };
  const progress = {
    get: () => state,
    subscribe(run: (v: Readonly<Record<string, PackProgress>>) => void) {
      listeners.add(run);
      run(state);
      return () => void listeners.delete(run);
    },
  };

  const save = async (next: PackIndex): Promise<void> => {
    index = next;
    await storage.writeText(INDEX_PATH, JSON.stringify(index));
  };

  const load = (): Promise<void> =>
    (loaded ??= (async () => {
      if (!storage.supported) return;
      const text = await storage.readText(INDEX_PATH);
      if (text !== undefined) index = JSON.parse(text) as PackIndex;
      const next: Record<string, PackProgress> = {};
      for (const p of Object.values(index.packs))
        next[p.key] = { state: 'ready', bytes_done: p.bytes, bytes_total: p.bytes };
      state = next;
      for (const l of listeners) l(state);
    })());

  /** Removes every file no pack and no pending download refers to. */
  const collect = async (): Promise<void> => {
    const keep = new Set<string>();
    for (const p of Object.values(index.packs)) for (const l of p.layers) keep.add(l.path);
    for (const [key, pend] of Object.entries(index.pending)) {
      const entry = manifest.find((m) => m.key === key && m.hash === pend.hash);
      if (entry !== undefined) for (const l of entry.layers) keep.add(filePath(pend.hash, l.layer));
    }
    for (const path of await storage.list()) if (!keep.has(path)) await storage.remove(path);
  };

  const without = <T>(rec: Readonly<Record<string, T>>, key: string): Record<string, T> => {
    return Object.fromEntries(Object.entries(rec).filter(([k]) => k !== key));
  };

  const verify = async (path: string, want: PackLayerEntry): Promise<boolean> => {
    const h = createSha256();
    for (let o = 0; o < want.bytes; o += HASH_CHUNK)
      h.update(await storage.read(path, o, Math.min(HASH_CHUNK, want.bytes - o)));
    return h.hex() === want.sha256;
  };

  /** Brings one layer file to complete and verified; throws with the reason on failure. */
  async function fetchLayer(
    l: PackLayerEntry,
    path: string,
    add: (n: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    let from = (await storage.size(path)) ?? 0;
    if (from > l.bytes) from = 0;
    add(from);
    if (from < l.bytes) {
      const res = await transport.download(l.url, from, signal);
      if (!res.partial && from > 0) {
        add(-from);
        from = 0;
      }
      const w = await storage.open(path, from);
      try {
        for await (const chunk of res.chunks) {
          await w.write(chunk);
          add(chunk.length);
        }
      } finally {
        await w.close();
      }
    }
    if ((await storage.size(path)) !== l.bytes || !(await verify(path, l))) {
      await storage.remove(path);
      throw new Error(`sha256 mismatch: ${l.layer}`);
    }
  }

  async function downloadPack(entry: PackManifestEntry, signal?: AbortSignal): Promise<void> {
    const old = index.packs[entry.key];
    if (old?.hash === entry.hash)
      return set(entry.key, { state: 'ready', bytes_done: entry.bytes, bytes_total: entry.bytes });
    let done = 0;
    const tick = (n: number): void => {
      done += n;
      set(entry.key, { state: 'downloading', bytes_done: done, bytes_total: entry.bytes });
    };
    tick(0);
    const had = index.pending[entry.key];
    let pend: PendingPack = had?.hash === entry.hash ? had : { hash: entry.hash, verified: [] };
    try {
      const layers: StoredLayer[] = [];
      for (const l of entry.layers) {
        const kept = old?.layers.find(
          (o) => o.layer === l.layer && o.sha256 === l.sha256 && o.bytes === l.bytes,
        );
        const path = kept?.path ?? filePath(entry.hash, l.layer);
        if (kept !== undefined || pend.verified.includes(l.layer)) tick(l.bytes);
        else {
          await fetchLayer(l, path, tick, signal);
          pend = { ...pend, verified: [...pend.verified, l.layer] };
          await save({ ...index, pending: { ...index.pending, [entry.key]: pend } });
        }
        layers.push({ ...l, path });
      }
      const stored: StoredPack = { ...entry, layers };
      await save({
        packs: { ...index.packs, [entry.key]: stored },
        pending: without(index.pending, entry.key),
      });
      await collect();
      set(entry.key, { state: 'ready', bytes_done: entry.bytes, bytes_total: entry.bytes });
    } catch (e) {
      set(entry.key, { state: 'failed', bytes_done: done, bytes_total: entry.bytes, reason: errorText(e) });
      await save({ ...index, pending: { ...index.pending, [entry.key]: pend } });
    }
  }

  const refresh: PackManager['refresh'] = () =>
    (job = job
      .catch(() => undefined)
      .then(async () => {
        if (!storage.supported) return { ok: false as const, reason: 'not supported' };
        await load();
        let m: readonly PackManifestEntry[];
        try {
          m = (await transport.manifest()).packs;
        } catch (e) {
          return { ok: false as const, reason: errorText(e) };
        }
        manifest = m;
        manifestSeen = true;
        const listed = new Set(m.map((p) => p.key));
        for (const key of Object.keys(index.packs)) {
          if (listed.has(key)) continue;
          await save({ packs: without(index.packs, key), pending: without(index.pending, key) });
          set(key, undefined);
        }
        await collect();
        for (const p of m) {
          if (index.packs[p.key]?.hash === p.hash)
            set(p.key, { state: 'ready', bytes_done: p.bytes, bytes_total: p.bytes });
          else if (state[p.key]?.state !== 'failed')
            set(p.key, { state: 'absent', bytes_done: 0, bytes_total: p.bytes });
        }
        return { ok: true as const, packs: m };
      })) as ReturnType<PackManager['refresh']>;

  const download: PackManager['download'] = (keys, signal) => {
    const wanted = manifest.filter((p) => keys.includes(p.key) && index.packs[p.key]?.hash !== p.hash);
    for (const p of wanted) set(p.key, { state: 'queued', bytes_done: 0, bytes_total: p.bytes });
    return (job = job
      .catch(() => undefined)
      .then(async () => {
        for (const p of wanted) {
          if (signal?.aborted === true)
            set(p.key, { state: 'failed', bytes_done: 0, bytes_total: p.bytes, reason: 'aborted' });
          else await downloadPack(p, signal);
        }
      })) as Promise<void>;
  };

  const remove: PackManager['remove'] = (keys) =>
    (job = job
      .catch(() => undefined)
      .then(async () => {
        await load();
        const held = keys.filter((k) => index.packs[k] !== undefined || index.pending[k] !== undefined);
        if (held.length === 0) return;
        let next = index;
        for (const key of held)
          next = { packs: without(next.packs, key), pending: without(next.pending, key) };
        await save(next);
        await collect();
        for (const key of held) {
          const listed = manifest.find((p) => p.key === key);
          set(
            key,
            listed === undefined ? undefined : { state: 'absent', bytes_done: 0, bytes_total: listed.bytes },
          );
        }
      })) as Promise<void>;

  const importPack: PackManager['importPack'] = (source, onProgress) =>
    (job = job
      .catch(() => undefined)
      .then(async (): Promise<ImportResult> => {
        if (!storage.supported) return { ok: false, kind: 'not_supported', reason: 'not supported' };
        await load();
        const written: string[] = [];
        let hash = '';
        let key = '';
        try {
          const r = await readPackFile(
            source,
            {
              accept(pack) {
                ({ key, hash } = pack);
                if (manifestSeen && !manifest.some((m) => m.key === pack.key))
                  throw new PackFileError('wrong_project', `pack "${pack.key}" is not listed`);
                return index.packs[pack.key]?.hash !== pack.hash;
              },
              open(l) {
                const path = filePath(hash, l.layer);
                written.push(path);
                return storage.open(path, 0);
              },
            },
            onProgress,
          );
          const tiles = r.pack.layers.reduce((n, l) => n + l.tiles, 0);
          if (!r.read) return { ok: true, key, tiles };
          const layers: StoredLayer[] = r.pack.layers.map((l) => ({ ...l, path: filePath(hash, l.layer) }));
          await save({
            packs: { ...index.packs, [key]: { ...r.pack, layers } },
            pending: without(index.pending, key),
          });
          await collect();
          set(key, { state: 'ready', bytes_done: r.pack.bytes, bytes_total: r.pack.bytes });
          return { ok: true, key, tiles };
        } catch (e) {
          // The old pack stays: only this file's own layer files go. A same-hash download in progress restarts.
          const held = new Set(Object.values(index.packs).flatMap((p) => p.layers.map((l) => l.path)));
          for (const path of written) if (!held.has(path)) await storage.remove(path);
          if (key !== '' && index.pending[key]?.hash === hash)
            await save({ ...index, pending: without(index.pending, key) });
          const kind = e instanceof PackFileError ? e.kind : 'write_failed';
          return { ok: false, kind, reason: errorText(e) };
        }
      })) as Promise<ImportResult>;

  const packFile: PackManager['packFile'] = async (key) => {
    await load();
    const pack = index.packs[key];
    if (pack === undefined || !pack.layers.every((l) => safeName(l.layer))) return undefined;
    const blobs: Blob[] = [];
    for (const l of pack.layers) {
      const b = await storage.blob(l.path);
      if (b === undefined) return undefined;
      blobs.push(b);
    }
    return { filename: packFileName(pack.label), blob: packFileBlob(pack, blobs) };
  };

  return {
    supported: storage.supported,
    importPack,
    packFile,
    progress,
    load,
    refresh,
    download,
    remove,
    hasLayer: (layer) => Object.values(index.packs).some((p) => p.layers.some((l) => l.layer === layer)),
    async sync(signal) {
      const r = await refresh();
      if (r.ok)
        await download(
          r.packs.map((p) => p.key),
          signal,
        );
    },
    async counts() {
      await load();
      return storageCounts(index);
    },
    files: {
      async layerFiles(layer) {
        await load();
        const out: PackLayerFile[] = [];
        for (const p of Object.values(index.packs))
          for (const l of p.layers)
            if (l.layer === layer)
              out.push({
                id: l.path.replace(/\.pmtiles$/, ''),
                layer,
                tileType: l.tile_type,
                maxZoom: l.max_zoom,
                read: (offset, length) => storage.read(l.path, offset, length),
              });
        return out;
      },
    },
  };
}
