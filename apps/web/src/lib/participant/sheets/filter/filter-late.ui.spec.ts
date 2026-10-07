// @vitest-environment jsdom
/** WP-812: the record arrives later (new device), and rapid switches become one write. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergePrefs, prefsOf, type Prefs, type PrefEntry, type PrefStore } from '@ueberblick/core/prefs';
import type { Key } from '@ueberblick/core/model';
import { bindHidden, recordFilterController } from './filter-prefs';
import { isVisible } from './filter-state';

const baum = 'baum' as Key;
const bank = 'bank' as Key;
const file = { types: {} } as never;

function fakeClient() {
  let store: PrefStore = {};
  let n = 0;
  const listeners = new Set<(p: Prefs) => void>();
  const writes: unknown[] = [];
  const apply = (path: string, value: unknown) => {
    store = mergePrefs(store, [
      { path, value, at: `2026-10-01T08:00:${String(n++).padStart(2, '0')}.000Z` } as PrefEntry,
    ]);
    for (const l of listeners) l(prefsOf(store));
  };
  return {
    writes,
    arrive: (hidden: unknown) => apply('filters.hidden', hidden),
    current: () => prefsOf(store),
    set(path: string, value: unknown) {
      writes.push(value);
      apply(path, value);
    },
    sync: () => Promise.resolve(true),
    subscribe: (fn: (p: Prefs) => void) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('late-arriving prefs record', () => {
  it('updates an untouched filter', () => {
    const c = fakeClient();
    const f = recordFilterController(c, file);
    const stop = bindHidden(f, c);
    c.arrive({ types: [bank], values: {} });
    expect(isVisible(f.state(), bank, undefined)).toBe(false);
    expect(c.writes).toHaveLength(0);
    stop();
  });

  it('does not override a local switch', () => {
    const c = fakeClient();
    const f = recordFilterController(c, file);
    const stop = bindHidden(f, c);
    f.setType(baum, false);
    c.arrive({ types: [bank], values: {} });
    expect(isVisible(f.state(), bank, undefined)).toBe(true);
    expect(isVisible(f.state(), baum, undefined)).toBe(false);
    stop();
  });
});

describe('write rate', () => {
  it('10 rapid toggles are one write with the final state', () => {
    const c = fakeClient();
    const f = recordFilterController(c, file);
    for (let i = 0; i < 10; i++) f.setType(bank, i % 2 === 1); // ends visible
    f.setType(baum, false);
    expect(c.writes).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(c.writes).toEqual([{ types: [baum], values: {} }]);
  });

  it('pagehide flushes the pending choice', () => {
    const c = fakeClient();
    const f = recordFilterController(c, file);
    const stop = bindHidden(f, c);
    f.setType(bank, false);
    expect(c.writes).toHaveLength(0);
    window.dispatchEvent(new Event('pagehide'));
    expect(c.writes).toEqual([{ types: [bank], values: {} }]);
    vi.advanceTimersByTime(1000);
    expect(c.writes).toHaveLength(1);
    stop();
  });

  it('the document becoming hidden flushes the pending choice (mobile force-quit)', () => {
    const c = fakeClient();
    const f = recordFilterController(c, file);
    const stop = bindHidden(f, c);
    f.setType(bank, false);
    document.dispatchEvent(new Event('visibilitychange')); // still visible: nothing yet
    expect(c.writes).toHaveLength(0);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expect(c.writes).toEqual([{ types: [bank], values: {} }]);
    stop();
  });

  it('flush() writes at once (sheet close)', () => {
    const c = fakeClient();
    const f = recordFilterController(c, file);
    f.setType(bank, false);
    f.flush();
    expect(c.writes).toHaveLength(1);
  });
});
