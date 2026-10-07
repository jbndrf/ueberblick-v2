/**
 * ConfigVersions: hydrated compiled configs in memory, refetch for the ones this core cannot read.
 * `hydrate` comes from core; the compiler never runs on the device (docs/07).
 */
import { CompiledConfigError, hydrate } from '@ueberblick/core/hydrate';
import type { CompiledConfig, CompiledConfigData } from '@ueberblick/core/hydrate';
import { keepSet } from './keep';
import type { ConfigVersions, ConfigVersionResult, ConfigVersionsDeps } from './contract';

function tryHydrate(data: CompiledConfigData): { config: CompiledConfig } | { error: string } {
  try {
    return { config: hydrate(data) };
  } catch (e) {
    // only "cannot read this stored form" means refetch; anything else is a bug and propagates
    if (e instanceof CompiledConfigError) return { error: e.message };
    throw e;
  }
}

export async function openConfigVersions(deps: ConfigVersionsDeps): Promise<ConfigVersions> {
  const { store, fetcher } = deps;
  const ready = new Map<number, CompiledConfig>();
  const wanted = new Set<number>();
  const errors = new Map<number, string>();
  const inflight = new Map<number, Promise<void>>();
  /** Bugs (not "unreadable") from background fetches; `refresh()` rethrows the first one. */
  const faults = new Map<number, unknown>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  /** `follow`, a fetch's commit and `retain` run one at a time, in arrival order (WP-669). */
  let chain: Promise<unknown> = Promise.resolve();
  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = chain.then(work, work);
    chain = run.catch(() => undefined);
    return run;
  }

  async function fetchOne(version: number): Promise<void> {
    try {
      let data: CompiledConfigData;
      try {
        data = await fetcher.fetchCompiled(version);
      } catch (e) {
        errors.set(version, e instanceof Error ? e.message : String(e)); // transport: stays awaiting
        return;
      }
      const h = tryHydrate(data); // a bug (not "unreadable") throws out of here
      if ('error' in h) {
        errors.set(version, h.error);
        return;
      }
      // one critical section with `retain`: no row is written for a version a retain just dropped, and none is
      // deleted while its fetch is committing
      await exclusive(async () => {
        if (!wanted.has(version)) return; // dropped by `retain` while in flight
        await store.putConfigVersion(version, data);
        ready.set(version, h.config);
        wanted.delete(version);
        errors.delete(version);
      });
    } finally {
      inflight.delete(version);
      notify();
    }
  }

  const want = (version: number): void => {
    wanted.add(version);
    if (inflight.has(version)) return;
    const p = fetchOne(version);
    inflight.set(version, p);
    p.catch((e: unknown) => faults.set(version, e)); // handled here; surfaced by refresh()
  };

  for (const row of await store.readConfigVersions()) {
    const h = tryHydrate(row.data);
    if ('config' in h) ready.set(row.version, h.config);
    else want(row.version);
  }

  let deployed: number | undefined;
  /** The live set of the latest `follow`; `undefined` before the first header (nothing may be pruned then). */
  let live: ReadonlySet<number> | undefined;

  return {
    get deployed() {
      return deployed;
    },
    follow(versions) {
      deployed = versions.deployed;
      live = new Set(versions.live);
      for (const v of versions.live) if (!ready.has(v) && !wanted.has(v)) want(v);
    },
    retain(queued) {
      return exclusive(async () => {
        if (live === undefined) return; // no header yet: the live set is unknown
        const runs = await queued();
        // read after the await: a `follow` that arrived meanwhile counts
        const keep = keepSet(live, runs);
        for (const v of [...ready.keys()]) if (!keep.has(v)) ready.delete(v);
        for (const v of [...wanted]) if (!keep.has(v)) wanted.delete(v);
        for (const v of [...errors.keys()]) if (!keep.has(v)) errors.delete(v);
        for (const row of await store.readConfigVersions()) {
          // wanted again meanwhile (a `get` of a queued run, a `follow`): its row stays
          const stillNeeded = keep.has(row.version) || live?.has(row.version) || wanted.has(row.version);
          if (!stillNeeded) await store.deleteConfigVersion(row.version);
        }
      });
    },
    get(version): ConfigVersionResult {
      const config = ready.get(version);
      if (config) return config;
      if (!wanted.has(version)) want(version);
      return 'refetching';
    },
    awaiting: () => [...wanted].sort((a, b) => a - b),
    async refresh() {
      for (const v of wanted) if (!inflight.has(v)) want(v);
      await Promise.allSettled([...inflight.values()]);
      const first = faults.values().next();
      if (!first.done) {
        faults.clear();
        throw first.value;
      }
    },
    lastError: (version) => errors.get(version),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
