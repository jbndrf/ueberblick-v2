/** Storage health through a port (docs/07 "iOS", docs/13 honest state). */
import type { StorageHealth, StoragePort } from './contract';

export async function readStorageHealth(
  port: StoragePort,
  options: { readonly requestPersist?: boolean } = {},
): Promise<StorageHealth> {
  let persisted = await port.persisted();
  if (!persisted && options.requestPersist) persisted = await port.persist();
  const estimate = await port.estimate();
  const standalone = port.isStandalone();
  return {
    persisted,
    usageBytes: estimate?.usage,
    quotaBytes: estimate?.quota,
    standalone,
    atRisk: !persisted && !standalone,
  };
}

interface StorageManagerLike {
  persisted(): Promise<boolean>;
  persist(): Promise<boolean>;
  estimate(): Promise<{ usage?: number; quota?: number }>;
}

/** The slice of `window`/`self` the browser port reads (a tab or a worker; workers have no matchMedia). */
export interface BrowserGlobals {
  readonly navigator?: { readonly storage?: StorageManagerLike };
  readonly matchMedia?: (query: string) => { readonly matches: boolean };
}

export function browserStoragePort(g: BrowserGlobals): StoragePort {
  const storage = g.navigator?.storage;
  return {
    persisted: async () => (storage ? storage.persisted() : false),
    persist: async () => (storage ? storage.persist() : false),
    estimate: async () => {
      if (!storage) return undefined;
      const e = await storage.estimate();
      return e.usage === undefined || e.quota === undefined ? undefined : { usage: e.usage, quota: e.quota };
    },
    isStandalone: () => g.matchMedia?.('(display-mode: standalone)').matches ?? false,
  };
}
