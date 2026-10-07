/** WP-808: the Einfach switches persist in the preference record; the start filter applies only without a personal choice. */
import { describe, expect, it } from 'vitest';
import { mergePrefs, prefsOf, type PrefEntry, type PrefStore } from '@ueberblick/core/prefs';
import { startFilter } from '@ueberblick/core';
import type { Key } from '@ueberblick/core/model';
import { createFilterController } from './filter-controller';
import { recordFilterPrefs } from './filter-prefs';
import { isVisible } from './filter-state';

const baum = 'baum' as Key;
const bank = 'bank' as Key;

function fakeClient() {
  let store: PrefStore = {};
  let n = 0;
  return {
    current: () => prefsOf(store),
    set(path: string, value: unknown) {
      const e = { path, value, at: `2026-10-01T08:00:${String(n++).padStart(2, '0')}.000Z` } as PrefEntry;
      store = mergePrefs(store, [e]);
    },
    sync: () => Promise.resolve(true),
  };
}
const startOf = (hide: Key[]) =>
  startFilter({
    types: Object.fromEntries(hide.map((k) => [k, { on_at_start: false, properties: {} }])),
  } as never);

describe('recordFilterPrefs', () => {
  it('load is null until the person switched something', () => {
    expect(recordFilterPrefs(fakeClient()).load()).toBeNull();
  });

  it('a switch survives a new controller (reload) on the same record', () => {
    const client = fakeClient();
    const first = createFilterController(recordFilterPrefs(client));
    first.setType(bank, false);
    first.setValue(baum, 'faellung', false, ['faellung', 'ok']);
    first.flush(); // the write is coalesced (WP-812); a reload flushes on pagehide
    const after = createFilterController(recordFilterPrefs(client));
    expect(isVisible(after.state(), bank, undefined)).toBe(false);
    expect(isVisible(after.state(), baum, 'faellung')).toBe(false);
    expect(isVisible(after.state(), baum, 'ok')).toBe(true);
  });

  it('the start filter applies only without a personal choice', () => {
    const client = fakeClient();
    const fresh = createFilterController(recordFilterPrefs(client), startOf([bank]));
    expect(isVisible(fresh.state(), bank, undefined)).toBe(false);
    fresh.setType(bank, true); // the person shows everything: their choice from now on
    fresh.flush();
    const after = createFilterController(recordFilterPrefs(client), startOf([bank]));
    expect(isVisible(after.state(), bank, undefined)).toBe(true);
  });
});
