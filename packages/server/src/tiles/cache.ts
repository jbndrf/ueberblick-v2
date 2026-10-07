/**
 * The on-disk tile cache (A-033): one file per tile, `<root>/<source key>/<z>/<x>/<y>.<ext>` (WMS: `wms/<hash>.<ext>`).
 *
 * - Writes are atomic: bytes go to a temp name next to the target and are renamed, so a reader sees the old file, no
 *   file or the whole new one, never a torn one.
 * - Freshness rides on the file's mtime: a tile is stale once `now - mtime > maxAge`. A tile that the upstream allows
 *   to be kept for `ttl` seconds gets `mtime = written + ttl - maxAge`, so one stat answers "still good?" with no
 *   sidecar file. The mtime also makes the ETag (`size-mtime`), which changes only when the tile is fetched again.
 * - The size is bounded: an in-memory index (path, size, last use) is built by one scan on the first write, kept
 *   current by writes and reads, and trimmed to 90% of the cap by least recent use when a write crosses the cap.
 *   A read never touches the index beyond a Map update (hot path: one `readFile`).
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface CacheHit {
  readonly bytes: Uint8Array;
  readonly ext: string;
  /** Changes whenever the tile is fetched again. */
  readonly etag: string;
  /** Seconds this tile stays fresh from now (the browser must not keep it longer). */
  readonly freshForS: number;
}

export interface TileCacheOptions {
  readonly root: string;
  readonly now: () => number;
  readonly maxBytes: number;
  /** Seconds. */
  readonly maxAgeS: number;
}

export interface TileCache {
  /** The first fresh file of `<dir>/<name>.<ext>` over `exts`, or `undefined`. */
  find(dir: readonly string[], name: string, exts: readonly string[]): Promise<CacheHit | undefined>;
  /** Stores a tile atomically; `ttlS` is how long the upstream allows keeping it (capped at the max age). */
  put(dir: readonly string[], name: string, ext: string, bytes: Uint8Array, ttlS: number): Promise<CacheHit>;
  /** Bytes the index counts (0 before the first write). Tests and the doctor read it. */
  size(): number;
}

interface Entry {
  size: number;
  used: number;
}

const TRIM_TO = 0.9;

export function createTileCache(opts: TileCacheOptions): TileCache {
  const index = new Map<string, Entry>();
  let total = 0;
  let loaded: Promise<void> | undefined;

  const scan = async (dir: string): Promise<void> => {
    let names;
    try {
      names = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      names.map(async (n) => {
        const path = join(dir, n.name);
        if (n.isDirectory()) return scan(path);
        if (n.name.endsWith('.tmp')) return rm(path, { force: true }); // a crash left it
        const st = await stat(path).catch(() => undefined);
        if (st === undefined || index.has(path)) return;
        index.set(path, { size: st.size, used: Math.max(st.atimeMs, st.mtimeMs) });
        total += st.size;
      }),
    );
  };
  const load = (): Promise<void> => (loaded ??= scan(opts.root));

  const trim = async (): Promise<void> => {
    if (total <= opts.maxBytes) return;
    const oldest = [...index.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [path, e] of oldest) {
      if (total <= opts.maxBytes * TRIM_TO) break;
      await rm(path, { force: true });
      index.delete(path);
      total -= e.size;
    }
  };

  const etagOf = (size: number, mtimeMs: number): string =>
    `"${size.toString(36)}-${Math.floor(mtimeMs).toString(36)}"`;

  return {
    size: () => total,
    async find(dir, name, exts) {
      for (const ext of exts) {
        const path = join(opts.root, ...dir, `${name}.${ext}`);
        let st;
        try {
          st = await stat(path);
        } catch {
          continue;
        }
        if (opts.now() - st.mtimeMs >= opts.maxAgeS * 1000) continue; // stale: fetched again, overwritten by `put`
        let bytes: Buffer;
        try {
          bytes = await readFile(path);
        } catch {
          continue; // evicted between the stat and the read
        }
        const known = index.get(path);
        if (known !== undefined) known.used = opts.now();
        return {
          bytes,
          ext,
          etag: etagOf(st.size, st.mtimeMs),
          freshForS: Math.max(0, opts.maxAgeS - (opts.now() - st.mtimeMs) / 1000),
        };
      }
      return undefined;
    },
    async put(dir, name, ext, bytes, ttlS) {
      await load();
      const path = join(opts.root, ...dir, `${name}.${ext}`);
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
      await writeFile(tmp, bytes);
      const mtimeMs = opts.now() + (Math.min(ttlS, opts.maxAgeS) - opts.maxAgeS) * 1000;
      try {
        await utimes(tmp, new Date(), new Date(mtimeMs));
        await rename(tmp, path);
      } catch (e) {
        await rm(tmp, { force: true });
        throw e;
      }
      total += bytes.length - (index.get(path)?.size ?? 0);
      index.set(path, { size: bytes.length, used: opts.now() });
      await trim();
      // The etag a later `find` computes from the same file: the file system keeps the mtime at its own precision.
      const st = await stat(path).catch(() => undefined);
      return {
        bytes,
        ext,
        etag: etagOf(bytes.length, st?.mtimeMs ?? mtimeMs),
        freshForS: Math.min(ttlS, opts.maxAgeS),
      };
    },
  };
}
