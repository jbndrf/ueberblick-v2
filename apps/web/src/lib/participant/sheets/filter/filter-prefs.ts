/**
 * Where the Einfach switches live: the person's preference record (`filters.hidden`, WP-808), so a reload keeps them and
 * they follow the person to another device (v3 bug 9: they were lost). `load()` is null while the person never switched
 * anything, so the project's start filter applies only then (A-040).
 */
import type { PrefsClient } from '@ueberblick/client';
import { startFilter } from '@ueberblick/core';
import type { JsonValue, Key, TemplateFile } from '@ueberblick/core/model';
import type { HiddenFilter } from '@ueberblick/core/prefs';
import { createFilterController, type FilterController } from './filter-controller';
import type { FilterPrefs, FilterState } from './filter-state';

export const HIDDEN_PREF = 'filters.hidden';

export const hiddenOf = (s: FilterState): HiddenFilter => ({
  types: [...s.hiddenTypes],
  values: Object.fromEntries([...s.hiddenValues].map(([t, v]) => [t, [...v]])),
});

export const stateOfHidden = (h: HiddenFilter): FilterState => ({
  hiddenTypes: new Set(h.types as readonly Key[]),
  hiddenValues: new Map(Object.entries(h.values).map(([t, v]) => [t as Key, new Set(v)])),
});

/** Rapid switches (the master switch) become one write after this pause. */
export const SAVE_DELAY_MS = 500;

type RecordClient = Pick<PrefsClient, 'current' | 'set' | 'sync'>;

export interface RecordFilterPrefs extends FilterPrefs {
  /** True once the person switched something on this device in this session. */
  touched(): boolean;
}

export function recordFilterPrefs(client: RecordClient): RecordFilterPrefs {
  let pending: FilterState | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let touched = false;
  const flush = (): void => {
    clearTimeout(timer);
    if (pending === null) return;
    const state = pending;
    pending = null;
    client.set(HIDDEN_PREF, hiddenOf(state) as unknown as JsonValue);
    void client.sync();
  };
  return {
    load() {
      const h = client.current().filters.hidden;
      return h === null ? null : stateOfHidden(h);
    },
    save(state) {
      touched = true;
      pending = state;
      clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DELAY_MS);
    },
    flush,
    touched: () => touched,
  };
}

export type RecordFilter = FilterController & { readonly touched: () => boolean };

/** The one filter of the open app: the person's stored switches, else the project's start filter (A-040). */
export function recordFilterController(client: RecordClient, file: TemplateFile): RecordFilter {
  const prefs = recordFilterPrefs(client);
  return Object.assign(createFilterController(prefs, startFilter(file)), { touched: prefs.touched });
}

/**
 * Binds the filter to the record while the page lives: a record that arrives later (first start on a new device)
 * is taken when the person has switched nothing on this device yet, and a pending switch is written when the page
 * hides (pagehide or visibilitychange to hidden). Returns the stop function (it flushes too).
 */
export function bindHidden(
  filter: RecordFilter,
  client: Pick<PrefsClient, 'current' | 'subscribe'>,
): () => void {
  const stop = client.subscribe(() => {
    const h = client.current().filters.hidden;
    if (h !== null && !filter.touched()) filter.adopt(stateOfHidden(h));
  });
  const hide = (): void => filter.flush();
  const hidden = (): void => {
    if (document.visibilityState === 'hidden') filter.flush(); // the reliable signal on mobile; pagehide may not fire
  };
  window.addEventListener('pagehide', hide);
  document.addEventListener('visibilitychange', hidden);
  return () => {
    stop();
    window.removeEventListener('pagehide', hide);
    document.removeEventListener('visibilitychange', hidden);
    filter.flush();
  };
}
