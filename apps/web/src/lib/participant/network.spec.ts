import { describe, expect, it } from 'vitest';
import { createNetwork, HEALTH_URL, PING_INTERVAL_MS, PING_TIMEOUT_MS } from './network';

function rig() {
  const timers: { id: number; at: number; fn: () => void }[] = [];
  let now = 0;
  let nextId = 1;
  const state = { online: true, visible: true, server: 'up' as 'up' | 'down' | 'hang', pings: 0 };
  const changed = new Set<() => void>();
  const network = createNetwork({
    fetch: async (url) => {
      expect(url).toBe(HEALTH_URL);
      state.pings++;
      if (state.server === 'hang') return new Promise<Response>(() => undefined);
      if (state.server === 'down') throw new TypeError('fail');
      return new Response('{}', { status: 200 });
    },
    timers: {
      set: (fn, ms) => {
        const id = nextId++;
        timers.push({ id, at: now + ms, fn });
        return id;
      },
      clear: (h) => {
        const i = timers.findIndex((t) => t.id === h);
        if (i >= 0) timers.splice(i, 1);
      },
    },
    browserOnline: () => state.online,
    pageVisible: () => state.visible,
    changed: { subscribe: (fn) => (changed.add(fn), () => changed.delete(fn)) },
  });
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const advance = async (ms: number) => {
    now += ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      timers.splice(timers.indexOf(due), 1);
      due.fn();
      await settle();
    }
  };
  return { network, state, changed, settle, advance, pending: () => timers.length };
}

describe('network reachability', () => {
  it('browser online but the server failing reads offline, and online again once it answers', async () => {
    const r = rig();
    r.state.server = 'down';
    const seen: boolean[] = [];
    r.network.subscribe((v) => seen.push(v));
    let rang = 0;
    r.network.becameReachable.subscribe(() => rang++);
    r.network.start();
    await r.settle();
    expect(r.network.current()).toBe(false);
    r.state.server = 'up';
    await r.advance(PING_INTERVAL_MS);
    expect(r.network.current()).toBe(true);
    expect(seen).toEqual([false, true]);
    expect(rang).toBe(1);
  });

  it('a server that never answers is offline after the timeout', async () => {
    const r = rig();
    r.state.server = 'hang';
    r.network.start();
    await r.settle();
    expect(r.network.current()).toBe(true); // not yet judged
    await r.advance(PING_TIMEOUT_MS);
    expect(r.network.current()).toBe(false);
  });

  it('pings at the v3 cadence and stops while the page is hidden', async () => {
    const r = rig();
    r.network.start();
    await r.settle();
    for (let i = 0; i < 3; i++) await r.advance(PING_INTERVAL_MS);
    expect(r.state.pings).toBe(4);
    r.state.visible = false;
    r.changed.forEach((f) => f());
    await r.advance(PING_INTERVAL_MS * 5);
    expect(r.state.pings).toBe(4);
    r.state.visible = true;
    r.changed.forEach((f) => f());
    await r.settle();
    expect(r.state.pings).toBe(5);
  });

  it('browser offline is offline at once, without a ping', async () => {
    const r = rig();
    r.network.start();
    await r.settle();
    const before = r.state.pings;
    r.state.online = false;
    r.changed.forEach((f) => f());
    await r.settle();
    expect(r.network.current()).toBe(false);
    expect(r.state.pings).toBe(before);
  });

  it('stop ends the pings and the event subscription', async () => {
    const r = rig();
    r.network.start();
    await r.settle();
    r.network.stop();
    expect(r.changed.size).toBe(0);
    expect(r.pending()).toBe(0);
  });
});
