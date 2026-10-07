import { describe, expect, it, vi } from 'vitest';
import type { StoragePort } from './contract';
import { browserStoragePort, readStorageHealth } from './health';

const port = (over: Partial<StoragePort> = {}): StoragePort => ({
  persisted: async () => false,
  persist: async () => false,
  estimate: async () => ({ usage: 10, quota: 100 }),
  isStandalone: () => false,
  ...over,
});

describe('storage health', () => {
  it('reports persistence, estimate and standalone through the port', async () => {
    const h = await readStorageHealth(port({ persisted: async () => true, isStandalone: () => true }));
    expect(h).toEqual({ persisted: true, usageBytes: 10, quotaBytes: 100, standalone: true, atRisk: false });
  });

  it('is at risk when neither persisted nor installed', async () => {
    expect((await readStorageHealth(port())).atRisk).toBe(true);
  });

  it('requests persistence when asked and reports the answer', async () => {
    const persist = vi.fn(async () => true);
    const h = await readStorageHealth(port({ persist }), { requestPersist: true });
    expect(persist).toHaveBeenCalled();
    expect(h.persisted).toBe(true);
  });

  it('says undefined, not zero, when the browser gives no estimate', async () => {
    const h = await readStorageHealth(port({ estimate: async () => undefined }));
    expect(h.usageBytes).toBeUndefined();
  });

  it('browserStoragePort reads navigator.storage and display-mode', async () => {
    const g = {
      navigator: {
        storage: {
          persisted: async () => true,
          persist: async () => true,
          estimate: async () => ({ usage: 1, quota: 2 }),
        },
      },
      matchMedia: (q: string) => ({ matches: q === '(display-mode: standalone)' }),
    };
    const p = browserStoragePort(g);
    expect(await p.persisted()).toBe(true);
    expect(p.isStandalone()).toBe(true);
    const none = browserStoragePort({});
    expect(await none.persisted()).toBe(false);
    expect(await none.estimate()).toBeUndefined();
    expect(none.isStandalone()).toBe(false);
  });
});
