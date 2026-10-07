/**
 * The pack build worker of one project (A-032 item 2): takes queued layers one at a time, builds each resumably,
 * records `failed(reason)` when the source gives up, and deletes the files of hashes nothing references any more.
 * Background work only: it never touches runs or sync, and one layer is in flight at any moment.
 */
import { rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Clock, TemplateFile } from '@ueberblick/core';
import type { Db } from '../db/driver';
import { BuildAborted, buildLayer } from './build';
import type { FetchRange } from './fetch';
import type { Guard } from '../tiles/guard';
import type { PackTiles } from './readers';
import {
  claimNext,
  deleteHash,
  deleteRow,
  enqueuePacks,
  markFailed,
  packTargets,
  requeueFailed,
  storedHashes,
} from './store';

export interface PackBuilderDeps {
  readonly db: Db;
  readonly clock: Clock;
  /** `<blobs>/packs/<project>`. */
  readonly dir: string;
  /** The deployed project file, or undefined before the first deploy. */
  readonly file: () => TemplateFile | undefined;
  readonly fetchRange: FetchRange;
  /** Tiles of `xyz` and `preset` layers through the tile service (A-033); without it only `pmtiles` layers build. */
  readonly tiles?: PackTiles;
  readonly guard?: Guard;
  /** Hashes kept although the deployed config no longer lists them (version pinning, A-029). */
  readonly pinned?: () => Iterable<string>;
  readonly batch?: number;
  /** Told about every failure (the logger); the row keeps the reason either way. */
  readonly onFailure?: (info: { hash: string; layer: string; reason: string }) => void;
}

export interface PackBuilder {
  /** Queues what the deployed config needs; returns the rows queued. */
  enqueue(): number;
  /** Builds until nothing is queued. Resolves with the layers built. A stopped signal leaves the row `building`. */
  drain(signal?: AbortSignal): Promise<number>;
  /** Queues the failed layers of a pack again; returns how many (0: unknown pack or none failed). */
  rebuild(packKey: string): number;
  /** Deletes the files and rows of hashes that no deployed or pinned version references; returns those hashes. */
  sweep(): string[];
}

export function createPackBuilder(deps: PackBuilderDeps): PackBuilder {
  const { db, clock } = deps;
  const now = (): string => clock.now();

  const referenced = (): Set<string> => {
    const file = deps.file();
    const keep = new Set(file === undefined ? [] : packTargets(file).map((t) => t.hash));
    for (const h of deps.pinned?.() ?? []) keep.add(h);
    return keep;
  };

  const sweep = (): string[] => {
    const keep = referenced();
    const stale = new Set(storedHashes(db).filter((h) => !keep.has(h)));
    // Directories without rows (a crash between the two deletes) are swept as well.
    try {
      for (const name of readdirSync(deps.dir)) if (!keep.has(name)) stale.add(name);
    } catch {
      // no directory yet: nothing was built
    }
    for (const hash of stale) {
      rmSync(join(deps.dir, hash), { recursive: true, force: true });
      deleteHash(db, hash);
    }
    return [...stale].sort();
  };

  return {
    enqueue() {
      const file = deps.file();
      return file === undefined ? 0 : enqueuePacks(db, file, now());
    },
    sweep,
    rebuild(packKey) {
      const file = deps.file();
      const target = file === undefined ? undefined : packTargets(file).find((t) => t.key === packKey);
      return target === undefined ? 0 : requeueFailed(db, target.hash, now());
    },
    async drain(signal) {
      sweep();
      let built = 0;
      for (;;) {
        if (signal?.aborted) return built;
        const row = claimNext(db, now());
        if (row === undefined) return built;
        const file = deps.file();
        const target =
          file === undefined ? undefined : packTargets(file).find((t) => t.hash === row.pack_hash);
        const layer = target?.layers.find((l) => l.layer === row.layer);
        if (target === undefined || layer === undefined) {
          deleteRow(db, row); // no deployed pack has this hash any more
          continue;
        }
        try {
          await buildLayer(
            {
              db,
              now,
              fetchRange: deps.fetchRange,
              ...(deps.tiles === undefined ? {} : { tiles: deps.tiles }),
              ...(deps.guard === undefined ? {} : { guard: deps.guard }),
              dir: deps.dir,
              ...(deps.batch === undefined ? {} : { batch: deps.batch }),
              ...(signal === undefined ? {} : { signal }),
            },
            row,
            target.def,
            layer.def,
          );
          built++;
        } catch (e) {
          if (e instanceof BuildAborted) return built;
          const reason = e instanceof Error ? e.message : String(e);
          markFailed(db, row, reason, now());
          deps.onFailure?.({ hash: row.pack_hash, layer: row.layer, reason });
        }
      }
    },
  };
}
