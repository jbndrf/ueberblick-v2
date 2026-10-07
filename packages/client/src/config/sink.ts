/**
 * The device keeps the live config versions (WP-669): the sink that applies a sync header and a completed pull to
 * `ConfigVersions`. Both sync hosts feed the same sink, so the in-thread host and the worker host behave alike (R1);
 * what is kept is decided in `keep.ts`. The sink lives where `ConfigVersions` lives (the main thread).
 */
import type { SyncVersions } from '@ueberblick/core/sync';
import type { StoredRun } from '../store';
import type { ConfigVersions, VersionsSink } from './contract';

export function versionsSink(deps: {
  readonly versions: Pick<ConfigVersions, 'follow' | 'retain'>;
  readonly store: { readRuns(): Promise<readonly StoredRun[]> };
}): VersionsSink {
  return {
    follow: (v) => deps.versions.follow(v),
    synced: () =>
      deps.versions.retain(async () => (await deps.store.readRuns()).map((r) => r.run.configVersion)),
  };
}

/**
 * A sink that is handed to a host before `ConfigVersions` exists (the host opens the store first); `bind` fills it in.
 */
export function lateVersionsSink(): VersionsSink & { bind(sink: VersionsSink): void } {
  let target: VersionsSink | undefined;
  // a follower tab can be relayed headers before `bind`: the last of each is replayed, in order
  let pendingFollow: SyncVersions | undefined;
  let pendingSynced: SyncVersions | undefined;
  return {
    bind(sink) {
      target = sink;
      if (pendingFollow) sink.follow(pendingFollow);
      if (pendingSynced) void sink.synced(pendingSynced);
      pendingFollow = pendingSynced = undefined;
    },
    follow(v) {
      if (target) target.follow(v);
      else pendingFollow = v;
    },
    synced(v) {
      if (target) return target.synced(v);
      pendingSynced = v;
      return Promise.resolve();
    },
  };
}
