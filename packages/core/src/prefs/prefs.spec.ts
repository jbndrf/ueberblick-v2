import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Json } from '../model';
import { mergePrefs, prefsOf, validatePrefValue, type PrefEntry, type PrefStore } from './index';

const PATHS = ['tools.chat', 'ui.theme', 'ui.locale', 'filters.active', 'tool_prefs.cluster.cap'];
const at = fc.integer({ min: 0, max: 50 }).map((n) => `2026-10-01T08:00:${String(n).padStart(2, '0')}.000Z`);
const entry: fc.Arbitrary<PrefEntry> = fc.record({
  path: fc.constantFrom(...PATHS),
  value: fc.constantFrom<Json>(true, false, 'dark', 'de', null, 3, { a: 1, b: 2 }, { b: 2, a: 1 }),
  at,
});
const edits = fc.array(entry, { maxLength: 12 });

describe('mergePrefs: last write wins per key', () => {
  it('two devices change different keys offline: both survive', () => {
    const base: PrefStore = {};
    const a = mergePrefs(base, [{ path: 'ui.theme', value: 'dark', at: '2026-10-01T08:00:01.000Z' }]);
    const b = mergePrefs(a, [{ path: 'tools.chat', value: true, at: '2026-10-01T08:00:02.000Z' }]);
    expect(prefsOf(b).ui.theme).toBe('dark');
    expect(prefsOf(b).tools['chat']).toBe(true);
  });

  it('the same key: the later timestamp wins, whichever arrives first', () => {
    const early: PrefEntry = { path: 'ui.theme', value: 'light', at: '2026-10-01T08:00:01.000Z' };
    const late: PrefEntry = { path: 'ui.theme', value: 'dark', at: '2026-10-01T08:00:09.000Z' };
    expect(prefsOf(mergePrefs({}, [early, late])).ui.theme).toBe('dark');
    expect(prefsOf(mergePrefs({}, [late, early])).ui.theme).toBe('dark');
  });

  it('property: order of edits never matters, repeating is harmless, the input is not changed', () => {
    fc.assert(
      fc.property(edits, edits, (x, y) => {
        const frozen = JSON.stringify(mergePrefs({}, x));
        const ab = mergePrefs(mergePrefs({}, x), y);
        const ba = mergePrefs(mergePrefs({}, y), x);
        const flat = mergePrefs({}, [...x, ...y]);
        const shuffled = mergePrefs({}, [...y, ...x].reverse());
        expect(ab).toEqual(ba);
        expect(ab).toEqual(flat);
        expect(ab).toEqual(shuffled);
        expect(mergePrefs(ab, [...x, ...y])).toEqual(ab);
        expect(JSON.stringify(mergePrefs({}, x))).toBe(frozen);
      }),
    );
  });

  it('property: every merged key holds the value of its latest edit', () => {
    fc.assert(
      fc.property(edits, (x) => {
        const m = mergePrefs({}, x);
        for (const [path, cell] of Object.entries(m)) {
          const maxAt = x
            .filter((e) => e.path === path)
            .map((e) => e.at)
            .sort()
            .at(-1);
          expect(cell.at).toBe(maxAt);
        }
      }),
    );
  });
});

describe('prefsOf', () => {
  it('builds the nested record with empty defaults', () => {
    expect(prefsOf({})).toEqual({
      tools: {},
      tool_prefs: {},
      filters: { saved: [], active: null, hidden: null },
      ui: {},
    });
    const p = prefsOf(
      mergePrefs({}, [
        { path: 'tool_prefs.cluster.cap', value: 300, at: '2026-10-01T08:00:01.000Z' },
        { path: 'ui.font_size', value: 'large', at: '2026-10-01T08:00:01.000Z' },
      ]),
    );
    expect(p.tool_prefs).toEqual({ cluster: { cap: 300 } });
    expect(p.ui.font_size).toBe('large');
  });
});

describe('validatePrefValue', () => {
  const ok = (p: string, v: unknown): boolean => validatePrefValue(p, v).ok;
  it('accepts the declared keys with the right types', () => {
    expect(ok('ui.offline_images', true)).toBe(true);
    expect(ok('ui.offline_images', 'yes')).toBe(false);
    expect(ok('tools.chat', true)).toBe(true);
    expect(ok('tool_prefs.cluster.cap', { a: [1, 'x', null] })).toBe(true);
    expect(ok('ui.theme', 'dark')).toBe(true);
    expect(ok('ui.font_size', 'xl')).toBe(true);
    expect(ok('ui.locale', 'de')).toBe(true);
    expect(ok('ui.map_layers', { base: 'osm', overlays: ['flur'] })).toBe(true);
    expect(ok('ui.map_layers', { base: null, overlays: [] })).toBe(true);
    expect(ok('filters.active', null)).toBe(true);
    expect(ok('filters.saved', [{ id: 'a', name: 'Meine', filters: { baum: 'self.x == 1' } }])).toBe(true);
  });
  it('refuses unknown keys and wrong types', () => {
    expect(ok('colour', 'red')).toBe(false);
    expect(ok('ui.sound', true)).toBe(false);
    expect(ok('ui.map_layers', { base: 'osm' })).toBe(false);
    expect(ok('ui.map_layers', { base: 1, overlays: [] })).toBe(false);
    expect(ok('ui.map_layers', { base: 'osm', overlays: [3] })).toBe(false);
    expect(ok('ui.map_layers', 'osm')).toBe(false);
    expect(ok('ui', {})).toBe(false);
    expect(ok('tools.chat.deep', true)).toBe(false);
    expect(ok('tools.Chat', true)).toBe(false);
    expect(ok('tools.chat', 'yes')).toBe(false);
    expect(ok('ui.theme', 'purple')).toBe(false);
    expect(ok('ui.locale', 'Deutsch!')).toBe(false);
    expect(ok('filters.saved', [{ id: 'a' }])).toBe(false);
    expect(ok('filters.active', 7)).toBe(false);
    expect(ok('tool_prefs.cluster.cap', undefined)).toBe(false);
    expect(ok('tool_prefs.cluster.cap', 'x'.repeat(20000))).toBe(false);
  });
});

describe('filters.hidden (the Einfach switches, WP-808)', () => {
  const hidden = { types: ['bank'], values: { baum: ['faellung'] } };
  it('round-trips through merge and prefsOf; null while never set', () => {
    expect(prefsOf({}).filters.hidden).toBeNull();
    const store = mergePrefs({}, [{ path: 'filters.hidden', value: hidden, at: '2026-10-01T08:00:01.000Z' }]);
    expect(prefsOf(store).filters.hidden).toEqual(hidden);
  });
  it('the later write wins, whichever arrives first', () => {
    const a: PrefEntry = { path: 'filters.hidden', value: hidden, at: '2026-10-01T08:00:01.000Z' };
    const b: PrefEntry = {
      path: 'filters.hidden',
      value: { types: [], values: {} },
      at: '2026-10-01T08:00:09.000Z',
    };
    expect(prefsOf(mergePrefs({}, [a, b])).filters.hidden).toEqual({ types: [], values: {} });
    expect(prefsOf(mergePrefs({}, [b, a])).filters.hidden).toEqual({ types: [], values: {} });
  });
  it('validates the shape', () => {
    expect(validatePrefValue('filters.hidden', hidden).ok).toBe(true);
    expect(validatePrefValue('filters.hidden', { types: 'bank', values: {} }).ok).toBe(false);
    expect(validatePrefValue('filters.hidden', { types: [], values: { baum: [1] } }).ok).toBe(false);
    expect(validatePrefValue('filters.hidden', { types: [] }).ok).toBe(false);
  });
});
