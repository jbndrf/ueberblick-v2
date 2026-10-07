import { describe, expect, it } from 'vitest';
import type { KeyedSignal, PullResult, ToolSync } from './contract';
import { createAutoSync } from './trigger';
import { manualSignal, manualTimers } from './test-server';

function rig() {
  const timers = manualTimers();
  const doorbell = manualSignal();
  const online = manualSignal();
  const visible = manualSignal();
  const rings = new Set<(tool: string) => void>();
  const toolBell: KeyedSignal = {
    subscribe: (fn) => {
      rings.add(fn);
      return () => rings.delete(fn);
    },
  };
  const log: string[] = [];
  const tools: ToolSync = {
    doorbell: toolBell,
    pull: async (tool) => {
      log.push(`pull:${tool}`);
      if (tool === 'bad') throw new Error('offline');
    },
    sync: async () => void log.push('sync'),
  };
  const errors: unknown[] = [];
  const auto = createAutoSync({
    worker: {
      pull: async () => ({ pages: 0, reset: undefined, cursor: 0 }) satisfies PullResult,
      status: () => ({}) as never,
      subscribe: () => () => undefined,
    },
    timers,
    doorbell,
    online,
    visible,
    tools,
    onError: (_t, e) => errors.push(e),
  });
  return {
    auto,
    timers,
    online,
    visible,
    rings,
    log,
    errors,
    ring: (k: string) => rings.forEach((f) => f(k)),
  };
}

describe('auto sync of tool streams', () => {
  it('syncs the tool streams on open, online and visible', () => {
    const r = rig();
    r.auto.start();
    r.online.ring();
    r.visible.ring();
    expect(r.log).toEqual(['sync', 'sync', 'sync']);
  });

  it('a tool doorbell pulls that tool only, debounced per key', () => {
    const r = rig();
    r.auto.start();
    r.log.length = 0;
    r.ring('chat');
    r.ring('chat');
    r.ring('live');
    expect(r.log).toEqual([]);
    r.timers.advance(500);
    expect(r.log.sort()).toEqual(['pull:chat', 'pull:live']);
  });

  it('stop unsubscribes the tool doorbell and cancels pending pulls', () => {
    const r = rig();
    r.auto.start();
    r.log.length = 0;
    r.ring('chat');
    r.auto.stop();
    r.timers.advance(500);
    expect(r.log).toEqual([]);
    expect(r.rings.size).toBe(0);
  });

  it('a failing tool pull is reported, not thrown', async () => {
    const r = rig();
    r.auto.start();
    r.ring('bad');
    r.timers.advance(500);
    await Promise.resolve();
    await Promise.resolve();
    expect(r.errors).toHaveLength(1);
  });
});
