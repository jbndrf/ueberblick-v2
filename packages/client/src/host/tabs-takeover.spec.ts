import { describe, expect, it, vi } from 'vitest';
import type { PullResult } from '../sync/contract';
import { openTabs, type TabHost } from './tabs';
import { FakeBus, FakeLocks } from './test-tabs';

const result = (n: number) => ({ reset: undefined, n }) as unknown as PullResult;

/** A host whose worker start is held until the test opens it, and that records what its worker is asked. */
function gatedHost() {
  let open!: () => void;
  let fail!: (e: Error) => void;
  const started = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  const log: string[] = [];
  let pulls = 0;
  const faults: Error[] = [];
  const host: TabHost = {
    startWorker: () => started.then(() => void log.push('started')),
    pullLocal: () => {
      // a real worker refuses a pull before `start`
      if (!log.includes('started')) return Promise.reject(new Error('pull arrived while the host was ready'));
      log.push('pull');
      return Promise.resolve(result(++pulls));
    },
    feed: () => undefined,
    fault: (e) => faults.push(e),
  };
  return { host, open, fail, log, faults };
}

const solo = (g: ReturnType<typeof gatedHost>) =>
  openTabs({ locks: new FakeLocks(), channel: new FakeBus().channel(), tabId: 'a' }, 'db', g.host);

describe('a takeover has no window in which a pull faults', () => {
  it('a pull between the lock grant and the worker start waits for the start, then runs', async () => {
    const g = gatedHost();
    const tabs = solo(g);
    const begun = tabs.begin();
    expect(tabs.isHolder()).toBe(true);
    let settled = false;
    const pulled = tabs.pull().finally(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(g.log).toEqual([]);
    g.open();
    await begun;
    await expect(pulled).resolves.toMatchObject({ n: 1 });
    expect(g.log).toEqual(['started', 'pull']);
    expect(g.faults).toEqual([]);
    tabs.close();
  });

  it('two pulls in that window cause exactly one worker pull', async () => {
    const g = gatedHost();
    const tabs = solo(g);
    const begun = tabs.begin();
    const first = tabs.pull();
    const second = tabs.pull();
    g.open();
    await begun;
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toBe(r2);
    expect(g.log.filter((l) => l === 'pull')).toHaveLength(1);
    // once the window is closed a pull is a pull of its own again
    await expect(tabs.pull()).resolves.toMatchObject({ n: 2 });
    expect(g.log.filter((l) => l === 'pull')).toHaveLength(2);
    tabs.close();
  });

  it('a pull in the window is answered, not dropped, when the worker start fails', async () => {
    const g = gatedHost();
    const tabs = solo(g);
    const begun = tabs.begin();
    const pulled = tabs.pull();
    g.fail(new Error('no worker'));
    await begun;
    await expect(pulled).rejects.toThrow('no worker');
    expect(g.faults.map((e) => e.message)).toEqual(['no worker']);
    tabs.close();
  });

  it("a follower's doorbell that reaches the new holder in the window runs after the start", async () => {
    const locks = new FakeLocks();
    const bus = new FakeBus();
    const first = gatedHost();
    first.open();
    const a = openTabs({ locks, channel: bus.channel(), tabId: 'a' }, 'db', first.host);
    await a.begin();
    const second = gatedHost();
    const b = openTabs({ locks, channel: bus.channel(), tabId: 'b' }, 'db', second.host);
    await b.begin();
    expect(b.isHolder()).toBe(false);
    const third = openTabs({ locks, channel: bus.channel(), tabId: 'c' }, 'db', gatedHost().host);
    await third.begin();
    // a leaves; b takes the lock but its worker start is held; c's doorbell reaches b in that window
    a.close();
    await vi.waitFor(() => expect(b.isHolder()).toBe(true));
    const doorbell = third.pull();
    // the bus delivers on the next timer turn; the timer queued by the doorbell runs before this one
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    second.open();
    await expect(doorbell).resolves.toMatchObject({ n: 1 });
    expect(second.log).toEqual(['started', 'pull']);
    expect(second.faults).toEqual([]);
    b.close();
    third.close();
  });
});
