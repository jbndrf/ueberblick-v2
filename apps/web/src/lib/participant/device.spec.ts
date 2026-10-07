import type { Network } from './network';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import type { IdbEnv } from '@ueberblick/client';
import type { Instant, Key, RunId } from '@ueberblick/core/model';
import type { RunProgress } from '@ueberblick/ui';
import { SINGLE_TAB, serveSyncHost, type MessagePortLike } from '@ueberblick/client';
import { openDevice, type Device, type DevicePorts } from './device';
import { switchDevice } from './device-switch';
import { bootstrap, server } from './device.testkit';
import type { SyncHostChoice } from './start-sync';
import { createWorkerSide } from './sync-worker-side';
import { identityOf } from './decode';
import type { Bootstrap, DeviceStart } from './http';

function signal() {
  const listeners = new Set<() => void>();
  return {
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    ring: () => listeners.forEach((l) => l()),
  };
}

/** The reachability port: `ring()` is the server answering again; `set(false)` is a dead server behind a live browser. */
function fakeNetwork() {
  const rings = signal();
  let reachable = true;
  const network: Network = {
    current: () => reachable,
    subscribe: () => () => undefined,
    becameReachable: rings,
    check: async () => reachable,
    start: () => undefined,
    stop: () => undefined,
  };
  return {
    network,
    set: (v: boolean) => void (reachable = v),
    ring() {
      reachable = true;
      rings.ring();
    },
  };
}

const opened: Device[] = [];
/** The worker end of the last worker-mode host: a test speaks through it as a stale or broken worker. */
let hostPort: MessagePort | undefined;
afterEach(() => opened.splice(0).forEach((d) => d.close()));

type Mode = SyncHostChoice['mode'];

async function open(
  s: ReturnType<typeof server>,
  mode: Mode = 'in-thread',
  boot: DeviceStart = bootstrap,
  shared?: { idb: IdbEnv; current?: Device },
) {
  const online = fakeNetwork();
  const visible = signal();
  const store = new Map<string, string>();
  const errors: string[] = [];
  const idb = shared?.idb ?? ({ factory: new IDBFactory(), keyRange: IDBKeyRange } as unknown as IdbEnv);
  // worker mode: the served host on one end of a channel, the app's proxy on the other (the same code as the browser worker)
  const sync: SyncHostChoice =
    mode === 'in-thread'
      ? { mode }
      : {
          mode,
          tabs: () => SINGLE_TAB,
          start: () => {
            const { port1, port2 } = new MessageChannel();
            hostPort = port1;
            serveSyncHost(
              port1 as unknown as MessagePortLike,
              createWorkerSide({ fetch: s.fetch, env: idb, now: () => new Date().toISOString() as Instant }),
            );
            return Object.assign(port2 as never, {
              terminate: () => {
                port1.close();
                port2.close();
              },
            });
          },
        };
  const ports: DevicePorts = {
    fetch: s.fetch,
    idb,
    sync,
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    },
    health: {
      persisted: async () => true,
      persist: async () => true,
      estimate: async () => undefined,
      isStandalone: () => false,
    },
    clock: { now: () => new Date().toISOString() as Instant },
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
    timers: { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as never) },
    mono: () => performance.now(),
    locks: undefined,
    network: online.network,
    visible,
    doorbell: () => signal(),
    toolDoorbell: () => ({ subscribe: () => () => undefined }),
    onError: (where) => void errors.push(where),
  };
  const device =
    shared === undefined
      ? await openDevice(boot, ports, 'de')
      : await switchDevice(shared.current, boot, ports, 'de');
  opened.push(device);
  return { device, online, errors, idb };
}

const until = async (ok: () => boolean | Promise<boolean>, ms = 3000): Promise<void> => {
  const t0 = Date.now();
  while (!(await ok())) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('the device follows a change of the roles (WP-784, in place since WP-796)', () => {
  it('updates the roles in place: the same device, the derived role key and tasks follow, the queue stays (WP-796)', async () => {
    const first = await open(server(), 'in-thread', bootstrap, { idb: sharedIdb() });
    const id = first.device.ids.runId() as RunId;
    await first.device.submitter.submit({ id, task: 'baumart_anlegen' as Key, input: { name_de: 'Eiche' } });
    const before = first.device.reader.startableTasks();
    const seen: string[] = [];
    const stop = first.device.onRolesChange(() => seen.push(first.device.roleKey ?? ''));
    const same = await open(
      server(),
      'in-thread',
      { ...bootstrap, participant: { ...bootstrap.participant, roles: ['bauhof'] } },
      { idb: first.idb, current: first.device },
    );
    expect(same.device).toBe(first.device);
    expect(first.device.actor.roles).toEqual(['bauhof']);
    expect(first.device.participant.roles).toEqual(['bauhof']);
    expect(first.device.roleKey).toBe('bauhof');
    expect(seen).toEqual(['bauhof']);
    expect(first.device.reader.startableTasks()).not.toEqual(before);
    expect(first.device.queue.status().pending).toBe(1); // the same roles again announce nothing
    await open(
      server(),
      'in-thread',
      { ...bootstrap, participant: { ...bootstrap.participant, roles: ['bauhof'] } },
      { idb: first.idb, current: first.device },
    );
    expect(seen).toHaveLength(1);
    stop();
  });

  it('a run submitted before and after a roles change carries the roles of its time', async () => {
    const first = await open(server(), 'in-thread', bootstrap, { idb: sharedIdb() });
    const a = first.device.ids.runId() as RunId;
    await first.device.submitter.submit({
      id: a,
      task: 'baumart_anlegen' as Key,
      input: { name_de: 'Eiche' },
    });
    await open(
      server(),
      'in-thread',
      { ...bootstrap, participant: { ...bootstrap.participant, roles: ['bauhof'] } },
      { idb: first.idb, current: first.device },
    );
    const runs = await first.device.store.readRuns();
    expect(runs.find((r) => r.run.id === a)?.run.actor.roles).toEqual(['verwaltung']);
  });

  it('lets the app subscribe to a scope change of the pulls', async () => {
    const { device } = await open(server(), 'in-thread', bootstrap);
    const stop = device.onAccessCheck(() => undefined);
    expect(typeof stop).toBe('function');
    stop();
  });
});

describe('bootstrap identity on the device', () => {
  const vera = { ...bootstrap, login: { token: 'AAAA', link: 'http://x/login?token=AAAA' } };

  it('carries the header and profile data: names, icon, expiry, own login', async () => {
    const { device } = await open(server(), 'in-thread', {
      ...vera,
      project: { key: 'demo', displayName: 'Musterstadt', icon: 'ab12', preview: false },
    });
    expect(device.identity).toMatchObject({
      project: { displayName: 'Musterstadt', icon: 'ab12' },
      participant: { name: 'Vera' },
      session: { expiresAt: '2027-01-01T00:00:00.000Z' },
      login: { token: 'AAAA' },
    });
  });

  it('starts offline from the cached identity alone, with the config version stored by the last online start', async () => {
    const first = await open(server(), 'in-thread', vera, { idb: sharedIdb() });
    first.device.close();
    const identity = identityOf(vera);
    const again = await open(server(), 'in-thread', identity, { idb: first.idb });
    expect(again.device.identity.participant.name).toBe('Vera');
    expect(again.device.reader.startableTasks()).toContain('baumart_anlegen');
  });

  it('a bootstrap for participant B closes the open device of A and opens B in its own database; A stays on disk', async () => {
    const first = await open(server(), 'in-thread', vera, { idb: sharedIdb() });
    const a = first.device;
    const bob: Bootstrap = {
      ...vera,
      participant: { id: 'bob', name: 'Bob', roles: ['verwaltung'], email: null, phone: null },
    };
    const second = await open(server(), 'in-thread', bob, { idb: first.idb, current: a });
    expect(second.device).not.toBe(a);
    expect(second.device.participant.id).toBe('bob');
    await expect(a.storageState()).resolves.toBeDefined(); // no throw: closing left the object inert, not the data gone
    const names = (await (first.idb.factory as unknown as IDBFactory).databases()).map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining(['ub-demo-vera', 'ub-demo-bob']));
  });

  it('the same participant keeps the open device', async () => {
    const first = await open(server(), 'in-thread', vera, { idb: sharedIdb() });
    const again = await open(server(), 'in-thread', vera, { idb: first.idb, current: first.device });
    expect(again.device).toBe(first.device);
  });
});

const sharedIdb = (): IdbEnv => ({ factory: new IDBFactory(), keyRange: IDBKeyRange }) as unknown as IdbEnv;

describe.each<Mode>(['in-thread', 'worker'])('device runtime, sync host %s', (mode) => {
  it('opens for the participant with the role, the actor and the bootstrapped config version', async () => {
    const { device } = await open(server(), mode);
    expect(device.roleKey).toBe('verwaltung');
    expect(device.actor).toEqual({ id: 'vera', kind: 'participant', roles: ['verwaltung'] });
    expect(device.version).toBe(1);
    expect(device.reader.startableTasks()).toContain('baumart_anlegen');
  });

  it('a bad tools.search setting is a typed problem in the app (the tool is not offered), not only a console line', async () => {
    // compile (WP-577) refuses such a file, so the bad source is planted in the stored data: the app still defends itself.
    const bad: Bootstrap = {
      ...bootstrap,
      compiled: {
        ...bootstrap.compiled,
        file: { ...bootstrap.compiled.file, tools: { search: { sources: ['address'] } } },
      },
    };
    const { device } = await open(server(), mode, bad);
    expect(device.problems.list()).toEqual([
      expect.objectContaining({ code: 'tool_setting_invalid', subject: 'search' }),
    ]);
  });

  it('a run made offline is stored and counted as unsent; coming online sends it once, with the config version', async () => {
    const s = server();
    const { device, online } = await open(s, mode);
    const id = device.ids.runId() as RunId;
    const seen: RunProgress[] = [];
    await device.submitter.submit({ id, task: 'baumart_anlegen' as Key, input: { name_de: 'Eiche' } });
    device.submitter.outcome(id, (p) => seen.push(p));
    await until(() => seen.length > 0);
    expect(seen[0]).toEqual({ state: 'queued' });
    expect(device.queue.status().pending).toBe(1);
    expect(s.state.runs).toEqual([]);

    s.state.up = true;
    online.ring();
    await until(() => device.queue.status().pending === 0);
    expect(s.state.runs).toEqual([expect.objectContaining({ id, configVersion: 1 })]);
    await until(() => seen.at(-1)?.state === 'accepted');
  });

  it('a run is not sent while the server does not answer, though the browser says online (WP-734)', async () => {
    const s = server();
    s.state.up = true;
    const { device, online } = await open(s, mode);
    online.set(false);
    const id = device.ids.runId() as RunId;
    await device.submitter.submit({ id, task: 'baumart_anlegen' as Key, input: { name_de: 'Eiche' } });
    await device.sync.syncNow();
    expect(s.state.runs).toEqual([]);
    expect(device.queue.status().pending).toBe(1);
    online.ring();
    await until(() => device.queue.status().pending === 0);
    expect(s.state.runs).toHaveLength(1);
  });

  it('the live versions of the sync header are kept on the device and the rest are pruned after a pull (WP-669)', async () => {
    const s = server();
    s.state.up = true;
    s.state.versions = { deployed: 2, live: [1, 2] };
    const { device } = await open(s, mode);
    const stored = async () => (await device.store.readConfigVersions()).map((r) => r.version).sort();
    await until(() => device.sync.worker.status().lastSyncedSeq !== undefined);
    await until(() => s.state.seen.some((u) => u.endsWith('/config/2')));
    await until(() => device.store.readConfigVersions().then((r) => r.length === 2));
    expect(await stored()).toEqual([1, 2]);
    s.state.versions = { deployed: 1, live: [1] };
    await device.sync.worker.pull();
    await until(() => device.store.readConfigVersions().then((r) => r.length === 1));
    expect(await stored()).toEqual([1]);
  });

  it('a first pull reaches the server and leaves the sync idle with its cursor', async () => {
    const s = server();
    s.state.up = true;
    const { device } = await open(s, mode);
    await until(() => device.sync.worker.status().lastSyncedSeq !== undefined);
    expect(device.sync.worker.status().phase).toBe('idle');
    expect(s.state.seen.some((u) => u.startsWith('/api/p/demo/sync?since=0'))).toBe(true);
  });
});

describe('a fault of the sync host reaches the person (WP-656)', () => {
  it('a message of another protocol version is a stale-page problem that says to reload; the console still gets it', async () => {
    const { device, errors } = await open(server(), 'worker');
    hostPort?.postMessage({ kind: 'from-the-future' });
    await until(() => device.problems.list().length > 0);
    // a message without this build's protocol version is what an old page and a new worker say to each other
    expect(device.problems.list()).toContainEqual({
      code: 'stale_bundle',
      subject: 'host',
      detail: 'bad_version',
    });
    expect(errors).toContain('sync:host');
  });
});

describe.each<Mode>(['in-thread', 'worker'])(
  'the browser session turned to another participant, sync host %s (WP-768)',
  (mode) => {
    it('nothing is sent or stored, the device stops and tells the other tabs; the queued run stays', async () => {
      const s = server();
      const { device, online } = await open(s, mode);
      const heard: string[] = [];
      const channel = new BroadcastChannel('ub-session-changed');
      channel.onmessage = () => void heard.push('changed');
      await device.submitter.submit({
        id: device.ids.runId(),
        task: 'baumart_anlegen' as Key,
        input: { name_de: 'Eiche' },
      });
      s.state.session = 'felix'; // a second tab signed in as felix: the shared cookie is his now
      s.state.up = true;
      online.ring();
      await device.sync.syncNow().catch(() => undefined);
      await until(() => heard.length > 0);
      channel.close();
      expect(s.state.runs).toEqual([]);
      expect(device.queue.status().pending).toBe(1);
      const before = s.state.seen.length;
      await device.sync.syncNow().catch(() => undefined);
      expect(s.state.seen.length).toBe(before);
    });
  },
);
