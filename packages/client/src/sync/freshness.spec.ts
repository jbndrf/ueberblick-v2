/** "Zuletzt synchronisiert" must survive a restart (WP-678): `lastSyncedAt` lives in the device meta store. */
import { describe, expect, it } from 'vitest';
import type { SyncResetReason } from '@ueberblick/core/registry';
import { fakeEnv, memoryMarker } from '../store/test-env';
import { openInThreadHost } from '../host/in-thread';
import { openTestHost } from '../host/test-hosts';
import { HOST_KINDS } from '../host/kinds';
import type { SyncStatus } from './contract';
import { FakeServer, memoryMeta } from './test-server';

const predictions = { rederive: () => Promise.resolve() };
const NOW = '2026-09-29T10:00:00Z';
const clock = { now: () => NOW as never };

function openIdb(env: ReturnType<typeof fakeEnv>, server: FakeServer) {
  return openInThreadHost({
    name: 'p1-a',
    options: { env, marker: memoryMarker() },
    transport: server,
    predictions,
    clock,
  });
}

describe('lastSyncedAt is persisted in the device meta store', () => {
  it('survives a reload; a device that never completed a pull stays "never"', async () => {
    const env = fakeEnv();
    const server = new FakeServer();
    server.write(1);
    const a = await openIdb(env, server);
    expect(a.sync.status().lastSyncedAt).toBeUndefined();
    await a.sync.pull();
    expect(a.sync.status().lastSyncedAt).toBe(NOW);
    a.dispose();
    const b = await openIdb(env, server);
    expect(b.sync.status().lastSyncedAt).toBe(NOW);
    b.dispose();
    const fresh = await openIdb(fakeEnv(), server);
    expect(fresh.sync.status().lastSyncedAt).toBeUndefined();
    fresh.dispose();
  });

  it('a failed pull does not set it', async () => {
    const env = fakeEnv();
    const server = new FakeServer();
    server.write(1);
    server.failOn = () => new Error('down');
    const a = await openIdb(env, server);
    await expect(a.sync.pull()).rejects.toThrow('down');
    a.dispose();
    const b = await openIdb(env, server);
    expect(b.sync.status().lastSyncedAt).toBeUndefined();
    b.dispose();
  });

  it.each(HOST_KINDS)('is reported by the %s host after a restart', async (kind) => {
    const env = fakeEnv();
    const server = new FakeServer();
    server.write(1);
    const meta = memoryMeta();
    const open = () =>
      openTestHost(kind, { transport: server, env, meta, rederived: [] as SyncResetReason[] });
    const a = await open();
    await a.sync.pull();
    a.dispose();
    const b = await open();
    const seen = await new Promise<SyncStatus>((resolve) => {
      if (b.sync.status().lastSyncedAt) resolve(b.sync.status());
      b.sync.subscribe((s) => s.lastSyncedAt && resolve(s));
    });
    expect(seen.lastSyncedAt).toBe(NOW);
    b.dispose();
  });
});
