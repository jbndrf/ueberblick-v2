import { describe, expect, it } from 'vitest';
import type { FeatureId } from '@ueberblick/core/model';
import { ALL, changedSignal, type Changed, type ChangeSource } from './changed';

const id = (n: number) => `f${n}` as FeatureId;

function setup() {
  let notify: Parameters<ChangeSource>[0] = () => undefined;
  let stopped = 0;
  const source: ChangeSource = (n) => {
    notify = n;
    return () => void stopped++;
  };
  let fire: (() => void) | undefined;
  const timers = {
    set: (fn: () => void) => {
      fire = fn;
      return 1;
    },
    clear: () => {
      fire = undefined;
    },
  };
  const feed = changedSignal([source], timers, 200);
  const seen: Changed[] = [];
  feed.subscribe((c) => seen.push(c));
  return {
    feed,
    seen,
    notify: (c: Parameters<typeof notify>[0]) => notify(c),
    flush: () => fire?.(),
    stopped: () => stopped,
  };
}

describe('changedSignal', () => {
  it('a burst is one call with the union of the ids', () => {
    const t = setup();
    t.notify([id(1), id(2)]);
    t.notify([id(2), id(3)]);
    expect(t.seen).toEqual([]);
    t.flush();
    expect(t.seen).toEqual([new Set([id(1), id(2), id(3)])]);
  });

  it('any source saying "all" makes the burst "all", and the next burst starts clean', () => {
    const t = setup();
    t.notify([id(1)]);
    t.notify(ALL);
    t.flush();
    t.notify([id(4)]);
    t.flush();
    expect(t.seen).toEqual([ALL, new Set([id(4)])]);
  });

  it('stop lets go of the sources and drops a pending call', () => {
    const t = setup();
    t.notify([id(1)]);
    t.feed.stop();
    t.flush();
    expect(t.seen).toEqual([]);
    expect(t.stopped()).toBe(1);
  });
});
