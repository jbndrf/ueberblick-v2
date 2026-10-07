/**
 * The pack builders of a server process (A-032 item 2, WP-351): one `PackBuilder` per project, and the rule that its
 * drains never overlap. `kick` queues what the deployed config needs and drains; a kick during a drain only marks
 * "run again", so the drain that is running picks the new rows up when it ends. `stop` aborts the signal of every drain
 * (the process is shutting down). Switched off (`enabled: false`, env `PACK_BUILD=0`) nothing is built or queued here.
 */
import type { Clock, TemplateFile } from '@ueberblick/core';
import type { Db } from '../db/driver';
import { createPackBuilder, type PackBuilder } from './builder';
import type { FetchRange } from './fetch';
import type { Guard } from '../tiles/guard';
import type { PackTiles } from './readers';
import { pinnedPackHashes } from './pinned';

export interface PackRuntimeDeps {
  readonly enabled: boolean;
  readonly clock: Clock;
  readonly fetchRange: FetchRange;
  /** The tile service of a project, for `xyz` and `preset` layers (A-033). */
  tiles?(projectKey: string): PackTiles;
  readonly guard?: Guard;
  projectDb(projectKey: string): Db;
  /** The deployed project file of the project, or undefined before the first deploy. */
  file(projectKey: string): TemplateFile | undefined;
  /** `<blobs>/packs/<project>`. */
  dir(projectKey: string): string;
  /** Told about a build that failed (the row keeps the reason) and about a drain that threw. */
  readonly onError?: (projectKey: string, info: { code: string; hash?: string; layer?: string }) => void;
}

export interface PackRuntime {
  /** Queues the deployed config's packs and builds them in the background. Never throws, never blocks. */
  kick(projectKey: string): void;
  /** Resolves when no drain is running or waiting (tests, shutdown). */
  idle(): Promise<void>;
  /** Aborts every drain; later kicks do nothing. Safe to call twice. */
  stop(): void;
}

interface Slot {
  readonly builder: PackBuilder;
  running: Promise<void> | undefined;
  again: boolean;
}

export function createPackRuntime(deps: PackRuntimeDeps): PackRuntime {
  const slots = new Map<string, Slot>();
  const abort = new AbortController();

  const slot = (key: string): Slot => {
    let s = slots.get(key);
    if (s === undefined) {
      const db = deps.projectDb(key);
      s = {
        running: undefined,
        again: false,
        builder: createPackBuilder({
          db,
          clock: deps.clock,
          dir: deps.dir(key),
          file: () => deps.file(key),
          fetchRange: deps.fetchRange,
          ...(deps.tiles === undefined ? {} : { tiles: deps.tiles(key) }),
          ...(deps.guard === undefined ? {} : { guard: deps.guard }),
          pinned: () => pinnedPackHashes(db),
          onFailure: (info) => deps.onError?.(key, { code: 'build_failed', ...info }),
        }),
      };
      slots.set(key, s);
    }
    return s;
  };

  async function run(key: string, s: Slot): Promise<void> {
    await Promise.resolve(); // the caller (a deploy) is never held up, and a throw never reaches it
    do {
      s.again = false;
      try {
        s.builder.enqueue();
        await s.builder.drain(abort.signal);
      } catch {
        deps.onError?.(key, { code: 'drain_threw' });
      }
    } while (s.again && !abort.signal.aborted);
    s.running = undefined;
  }

  return {
    kick(key) {
      if (!deps.enabled || abort.signal.aborted) return;
      let s: Slot;
      try {
        s = slot(key);
      } catch {
        deps.onError?.(key, { code: 'drain_threw' });
        return;
      }
      if (s.running !== undefined) s.again = true;
      else s.running = run(key, s);
    },
    async idle() {
      for (;;) {
        const pending = [...slots.values()].flatMap((s) => (s.running === undefined ? [] : [s.running]));
        if (pending.length === 0) return;
        await Promise.all(pending);
      }
    },
    stop() {
      abort.abort();
    },
  };
}
