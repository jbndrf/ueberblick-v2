import { describe, expect, it, vi } from 'vitest';
import type { Seq } from '@ueberblick/core/model';
import { SINGLE_TAB } from '@ueberblick/client';
import type {
  DeviceStore,
  PullResult,
  SyncHost,
  SyncHostOptions,
  SyncStatus,
  SyncWorker,
} from '@ueberblick/client';
import { HOST_OPEN_TIMEOUT_MS, startSync, type StartSyncDeps, type SyncHostChoice } from './start-sync';

type Refresher = { predictions: { rederive(reason: string): Promise<void> } };

function signal() {
  const listeners = new Set<() => void>();
  return {
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    ring: () => listeners.forEach((l) => l()),
    count: () => listeners.size,
  };
}

const idle: SyncStatus = {
  phase: 'idle',
  lastSyncedAt: undefined,
  lastSyncedSeq: undefined,
  lastError: undefined,
  featuresLoaded: 0,
};

const queueRing = new Set<() => void>();

function setup(
  choice: SyncHostChoice = { mode: 'in-thread' },
  pullOutcome: () => Promise<PullResult> = async () => ({ pages: 1, reset: undefined, cursor: 7 as Seq }),
) {
  const doorbell = signal();
  const online = signal();
  const visible = signal();
  const store = {} as DeviceStore;
  const queue = {
    rederive: vi.fn(async () => undefined),
    onPulled: vi.fn(async () => undefined),
    resetBackoff: vi.fn(),
    drain: vi.fn(async () => ({ accepted: 0, refused: 0, review: 0, hold: undefined, busy: false })),
    close: vi.fn(),
    status: vi.fn(() => ({ awaitingPull: 0 })),
    subscribe: vi.fn((fn: () => void) => {
      queueRing.add(fn);
      return () => queueRing.delete(fn);
    }),
  };
  const pull = vi.fn(pullOutcome);
  const dispose = vi.fn();
  const opened: SyncHostOptions[] = [];
  const worker: SyncWorker = { pull, status: () => idle, subscribe: () => () => undefined };
  const deps: StartSyncDeps = {
    name: 'ub-demo-anna',
    project: 'demo',
    participant: 'anna',
    options: { env: {} as never, marker: { isInitialised: () => true, markInitialised: () => undefined } },
    host: choice,
    transport: { fetchPage: async () => Promise.reject(new Error('unused')) },
    clock: { now: () => '2026-09-30T10:00:00.000Z' as never },
    timers: { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as never) },
    doorbell,
    online,
    visible,
    queueFor: async (s) => {
      expect(s).toBe(store); // the queue is built over the host's store
      return queue;
    },
    openHost: async (o) => {
      opened.push(o);
      const host: SyncHost = { store, sync: worker, dispose };
      return host;
    },
  };
  return { deps, queue, pull, doorbell, online, visible, dispose, opened };
}

const settle = () => new Promise((r) => setTimeout(r, 5));

describe('startSync', () => {
  it("opens the in-thread host with the main-thread transport, and the run queue is the host's prediction refresher", async () => {
    const t = setup();
    const handle = await startSync(t.deps);
    const o = t.opened[0];
    expect(o).toMatchObject({ mode: 'in-thread', name: 'ub-demo-anna', transport: t.deps.transport });
    // the refresher handed to the host forwards to the queue that was built afterwards
    await (o as unknown as Refresher).predictions.rederive('scope_changed');
    expect(t.queue.rederive).toHaveBeenCalledWith('scope_changed');
    handle.stop();
  });

  it('opens the worker host with a started worker, the project as its only setting, and ends the worker on dispose', async () => {
    const terminate = vi.fn();
    const port = { postMessage: vi.fn(), onmessage: null, terminate };
    const tabs = vi.fn(() => SINGLE_TAB);
    const t = setup({ mode: 'worker', start: () => port, tabs });
    const handle = await startSync(t.deps);
    const o = t.opened[0] as Extract<SyncHostOptions, { mode: 'worker' }>;
    expect(o).toMatchObject({
      mode: 'worker',
      name: 'ub-demo-anna',
      config: { project: 'demo', participant: 'anna' },
      port,
    });
    // several tabs of one database share one sync (WP-572): the choice builds the coordination for this store's name
    expect(tabs).toHaveBeenCalledWith('ub-demo-anna');
    expect(o.tabs).toBe(SINGLE_TAB);
    o.onDispose?.();
    expect(terminate).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('a refresher asked before the queue exists says so, loudly', async () => {
    const t = setup();
    let early: Promise<void> | undefined;
    const open = t.deps.openHost as NonNullable<StartSyncDeps['openHost']>;
    const handle = await startSync({
      ...t.deps,
      openHost: async (o) => {
        early = (o as unknown as Refresher).predictions.rederive('scope_changed');
        early.catch(() => undefined);
        return open(o);
      },
    });
    handle.stop();
    await expect(early).rejects.toThrow(/not open yet/);
  });

  it('a queue that fails to build closes the host again and the error surfaces', async () => {
    const t = setup();
    await expect(
      startSync({
        ...t.deps,
        queueFor: async () => {
          throw new Error('config unreadable');
        },
      }),
    ).rejects.toThrow('config unreadable');
    expect(t.dispose).toHaveBeenCalledTimes(1);
  });

  it('says so when a pull ended in a scope change, and on sync now, not on other pulls (WP-784)', async () => {
    const onAccessCheck = vi.fn();
    const t = setup({ mode: 'in-thread' }, async () => ({
      pages: 1,
      reset: 'scope_changed',
      cursor: 7 as Seq,
    }));
    const handle = await startSync({ ...t.deps, onAccessCheck });
    await handle.worker.pull();
    expect(onAccessCheck).toHaveBeenCalled();
    handle.stop();

    const quiet = vi.fn();
    const u = setup();
    const h2 = await startSync({ ...u.deps, onAccessCheck: quiet });
    await h2.worker.pull();
    expect(quiet).not.toHaveBeenCalled();
    await h2.syncNow();
    expect(quiet).not.toHaveBeenCalled(); // WP-793: a manual sync rings only on a change
    h2.stop();
  });

  it('asks for the roles only after a send in flight has settled (WP-792)', async () => {
    const order: string[] = [];
    const t = setup({ mode: 'in-thread' }, async () => ({
      pages: 1,
      reset: 'scope_changed',
      cursor: 7 as Seq,
    }));
    let finish: () => void = () => undefined;
    t.queue.drain.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            order.push('send settled');
            resolve({ accepted: 0, refused: 1, review: 0, hold: undefined, busy: false });
          };
        }),
    );
    const handle = await startSync({ ...t.deps, onAccessCheck: () => order.push('roles') });
    const pulling = handle.worker.pull();
    await settle();
    expect(order).toEqual([]);
    finish();
    await pulling;
    expect(order).toEqual(['send settled', 'roles']);
    handle.stop();
  });

  it('rings once when a pull reports a changed access value (WP-793), not when it does not', async () => {
    const onAccessCheck = vi.fn();
    const t = setup({ mode: 'in-thread' }, async () => ({
      pages: 1,
      reset: undefined,
      cursor: 7 as Seq,
      accessChanged: true,
    }));
    const handle = await startSync({ ...t.deps, onAccessCheck });
    await settle(); // the pull on open has finished
    onAccessCheck.mockClear();
    await handle.worker.pull();
    expect(onAccessCheck).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  describe('the access baseline from the bootstrap (WP-798)', () => {
    const result =
      (access?: string): (() => Promise<PullResult>) =>
      async () => ({
        pages: 1,
        reset: undefined,
        cursor: 7 as Seq,
        ...(access === undefined ? {} : { access }),
      });

    it('rings on a first pull whose access differs from the seed, once', async () => {
      const onAccessCheck = vi.fn();
      const t = setup({ mode: 'in-thread' }, result('a2'));
      const handle = await startSync({ ...t.deps, onAccessCheck, access: 'a1' });
      await settle(); // the pull on open
      expect(onAccessCheck).toHaveBeenCalledTimes(1);
      await handle.worker.pull(); // the baseline is now the worker's: the same value rings no more
      expect(onAccessCheck).toHaveBeenCalledTimes(1);
      handle.stop();
    });

    it('stays silent on a first pull equal to the seed', async () => {
      const onAccessCheck = vi.fn();
      const t = setup({ mode: 'in-thread' }, result('a1'));
      const handle = await startSync({ ...t.deps, onAccessCheck, access: 'a1' });
      await settle();
      await handle.worker.pull();
      expect(onAccessCheck).not.toHaveBeenCalled();
      handle.stop();
    });

    it('without a seed, or against a server that sends no access, it behaves as before', async () => {
      const a = vi.fn();
      const t = setup({ mode: 'in-thread' }, result('a2'));
      const h1 = await startSync({ ...t.deps, onAccessCheck: a });
      await settle();
      expect(a).not.toHaveBeenCalled();
      h1.stop();
      const b = vi.fn();
      const u = setup({ mode: 'in-thread' }, result());
      const h2 = await startSync({ ...u.deps, onAccessCheck: b, access: 'a1' });
      await settle();
      expect(b).not.toHaveBeenCalled();
      h2.stop();
    });
  });

  it('pulls on open, and tells the queue how far a pull reached', async () => {
    const t = setup();
    const handle = await startSync(t.deps);
    await settle();
    expect(t.pull).toHaveBeenCalledTimes(1);
    expect(t.queue.onPulled).toHaveBeenCalledWith(7);
    handle.stop();
  });

  it('a failed pull does not reach the queue and is reported, not swallowed', async () => {
    const onError = vi.fn();
    const t = setup({ mode: 'in-thread' }, async () => Promise.reject(new Error('down')));
    const handle = await startSync({ ...t.deps, onError });
    await settle();
    expect(t.queue.onPulled).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
    handle.stop();
  });

  it('coming back online or into focus ends a backoff and sends the queue', async () => {
    const t = setup();
    const handle = await startSync(t.deps);
    await settle();
    t.online.ring();
    expect(t.queue.resetBackoff).toHaveBeenCalledTimes(1);
    expect(t.queue.drain).toHaveBeenCalledTimes(1);
    t.visible.ring();
    expect(t.queue.resetBackoff).toHaveBeenCalledTimes(2);
    expect(t.queue.drain).toHaveBeenCalledTimes(2);
    handle.stop();
  });

  it('stop lets go of every signal and closes the host', async () => {
    const t = setup();
    const handle = await startSync(t.deps);
    handle.stop();
    expect([t.online.count(), t.visible.count(), t.doorbell.count()]).toEqual([0, 0, 0]);
    expect(t.dispose).toHaveBeenCalledTimes(1);
  });

  it('syncNow pulls and drains once, for a "Sync now"', async () => {
    const t = setup();
    const handle = await startSync(t.deps);
    await settle();
    t.pull.mockClear();
    t.queue.drain.mockClear();
    await handle.syncNow();
    expect(t.pull).toHaveBeenCalledTimes(1);
    expect(t.queue.resetBackoff).toHaveBeenCalled();
    expect(t.queue.drain).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('pulls once when the queue starts waiting for a pull, whatever the doorbell does (WP-865)', async () => {
    const t = setup();
    const handle = await startSync(t.deps);
    await settle();
    t.pull.mockClear();
    // a run was accepted: the server's answer is in, the pull that carries it is not
    t.queue.status.mockReturnValue({ awaitingPull: 1 });
    queueRing.forEach((fn) => fn());
    await settle();
    expect(t.pull).toHaveBeenCalledTimes(1);
    // still waiting on the next change of the queue (the pull did not cover it yet): no pull loop
    queueRing.forEach((fn) => fn());
    await settle();
    expect(t.pull).toHaveBeenCalledTimes(1);
    // covered, then another run accepted: a new wait, a new pull
    t.queue.status.mockReturnValue({ awaitingPull: 0 });
    queueRing.forEach((fn) => fn());
    t.queue.status.mockReturnValue({ awaitingPull: 1 });
    queueRing.forEach((fn) => fn());
    await settle();
    expect(t.pull).toHaveBeenCalledTimes(2);
    handle.stop();
    expect(queueRing.size).toBe(0);
  });

  it('stop closes the queue so its own retry timer is cancelled', async () => {
    const t = setup();
    const handle = await startSync(t.deps);
    await settle();
    expect(t.queue.close).not.toHaveBeenCalled();
    handle.stop();
    expect(t.queue.close).toHaveBeenCalledTimes(1);
  });
  it('runs the tool streams with the sync (WP-684): all on open, one tool on its own doorbell', async () => {
    const t = setup();
    const ring: { fn?: (key: string) => void } = {};
    const tools = {
      doorbell: { subscribe: (fn: (key: string) => void) => ((ring.fn = fn), () => undefined) },
      pull: vi.fn(async () => undefined),
      sync: vi.fn(async () => undefined),
    };
    const handle = await startSync({ ...t.deps, tools });
    expect(tools.sync).toHaveBeenCalledTimes(1);
    ring.fn?.('chat');
    await new Promise((r) => setTimeout(r, 600));
    expect(tools.pull).toHaveBeenCalledWith('chat');
    handle.stop();
  });

  it('fails with an error when the host never opens, and terminates the worker (WP-717)', async () => {
    vi.useFakeTimers();
    try {
      const terminate = vi.fn();
      const t = setup({
        mode: 'worker',
        start: () => ({ terminate }) as never,
        tabs: () => SINGLE_TAB,
      });
      let late: ((h: SyncHost) => void) | undefined;
      const started = startSync({
        ...t.deps,
        openHost: (o) => (t.opened.push(o), new Promise<SyncHost>((r) => (late = r))),
      });
      const failed = expect(started).rejects.toThrow(/did not open within/);
      await vi.advanceTimersByTimeAsync(HOST_OPEN_TIMEOUT_MS);
      await failed;
      expect(terminate).toHaveBeenCalledOnce();
      // a host that arrives after the timeout is closed, never left running
      late?.({ store: {} as DeviceStore, sync: {} as SyncWorker, dispose: t.dispose });
      await vi.advanceTimersByTimeAsync(1);
      expect(t.dispose).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
