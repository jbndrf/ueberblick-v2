/** The one holder of the filter state: the sheet writes it, the map's filtered source and the sheet read it. */
import type { Key } from '@ueberblick/core/model';
import {
  emptyFilter,
  memoryPrefs,
  revealType,
  setTypeVisible,
  setValueVisible,
  type FilterPrefs,
  type FilterState,
} from './filter-state';

/** A view that replaces the switches while it is active: a role's preset, or one of the person's saved filters. */
export interface ActiveView {
  readonly kind: 'preset' | 'saved';
  readonly key: string;
}

export interface FilterController {
  state(): FilterState;
  /** `stages`: the Objektart's declared stages, so the type and its stages follow each other (v3). */
  setType(type: Key, visible: boolean, stages?: readonly string[]): void;
  /** Switches only the type on; its hidden stages stay as the participant set them. */
  revealType(type: Key): void;
  setValue(type: Key, value: string, visible: boolean, stages?: readonly string[]): void;
  /** The active view, or null for the switches (v3 "Standard"). While one is active the switches do nothing. */
  activeView(): ActiveView | null;
  setActiveView(view: ActiveView | null): void;
  /** Counts up whenever the active view's own filter changed (an edit in the builder, the tool switched on or off). */
  viewRevision(): number;
  /** The active view's filter changed: the map evaluates it again. */
  refreshView(): void;
  /** Takes a state that arrived from the record (another device) without writing it back. */
  adopt(state: FilterState): void;
  /** Writes the pending switches to the record now (sheet close, page hide). */
  flush(): void;
  subscribe(listener: () => void): () => void;
}

/**
 * `start`: the project's start filter (core `startFilter`, A-040). It applies only while the person has stored nothing;
 * it is never written to the prefs, so a changed start reaches everyone who has not switched anything yet (v3
 * `+page.svelte:1061-1146` applied it only on the first visit).
 */
export function createFilterController(
  prefs: FilterPrefs = memoryPrefs(),
  start: FilterState = emptyFilter,
): FilterController {
  let current = prefs.load() ?? start;
  let active: ActiveView | null = null;
  let revision = 0;
  const listeners = new Set<() => void>();
  const ring = (): void => {
    for (const l of [...listeners]) l();
  };
  const set = (next: FilterState): void => {
    current = next;
    prefs.save(next);
    ring();
  };
  return {
    state: () => current,
    setType: (type, visible, stages) => set(setTypeVisible(current, type, visible, stages)),
    revealType: (type) => set(revealType(current, type)),
    setValue: (type, value, visible, stages) => set(setValueVisible(current, type, value, visible, stages)),
    activeView: () => active,
    setActiveView(view) {
      if (active?.kind === view?.kind && active?.key === view?.key) return;
      active = view;
      ring();
    },
    adopt(state) {
      current = state;
      ring();
    },
    flush: () => prefs.flush?.(),
    viewRevision: () => revision,
    refreshView() {
      revision += 1;
      ring();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
