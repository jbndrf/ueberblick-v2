/**
 * Which sheets are open on the map screen, as a pure state: a list of slots.
 * Layer, Filter, Werkzeuge and Einstellungen are one group (one open at a time, the bar button toggles it); the chat is
 * its own flag as in v3 (`chatSheetOpen`, `+page.svelte:188`): the group never closes it and a tile or "Im Chat erwähnen" opens it, only the + closes it (`:218,266`); Neu and
 * Zuletzt belong to the + cycle (`bar.ts`); the feature sheet and the cluster sheet are the map's own (a tap on a feature or
 * on a cluster): one of the two stands. As in v3 the detail is not touched by the group sheets or the + (their flags
 * are separate from the selection, `+page.svelte:2808`), and Zuletzt stays open when the detail opens beside it.
 */
import { nextFab, type FabStep } from './bar';
import type { SheetSlot } from './sheets';

export type Panels = readonly SheetSlot[];

const GROUP: readonly SheetSlot[] = ['layers', 'filter', 'tools', 'settings'];
const FAB: readonly SheetSlot[] = ['create', 'recent'];
/** The map's own sheets: a tap on a feature or on a cluster opens one, and only one stands over the map. */
const OWN: readonly SheetSlot[] = ['feature', 'cluster'];

const without = (open: Panels, drop: readonly SheetSlot[]): Panels => open.filter((s) => !drop.includes(s));

/** A bar or header button for `slot`: opens it (closing its group), or closes it when it is open. */
export function toggle(open: Panels, slot: SheetSlot): Panels {
  if (open.includes(slot)) return without(open, [slot]);
  if (slot === 'chat') return [...open, slot];
  // the detail replaces the other detail and Neu; Zuletzt stays beside it (v3 `besideDetail`) and a group sheet stays
  if (OWN.includes(slot)) return [...without(open, [...OWN, 'create']), slot];
  if (GROUP.includes(slot)) return [...without(open, [...GROUP, ...FAB]), slot];
  return [...without(open, GROUP), slot];
}

export const close = (open: Panels, slot: SheetSlot): Panels => without(open, [slot]);

/** Where the + cycle stands. */
export const fabStep = (open: Panels): FabStep =>
  open.includes('recent') ? 2 : open.includes('create') ? 1 : 0;

/** The + button: closed, Neu, Neu with Zuletzt beside it, closed. */
export function stepFab(open: Panels): Panels {
  const base = without(open, [...GROUP, ...FAB, 'chat']);
  const step = nextFab(fabStep(open));
  return step === 0 ? base : step === 1 ? [...base, 'create'] : [...base, 'create', 'recent'];
}

/** A tap on empty map (v3 `handleMapClick`, `+page.svelte:2394`): the detail, the cluster detail, Neu and Zuletzt close. */
export function afterMapTap(open: Panels, placing = false): Panels {
  if (placing) return open;
  const rest = without(open, [...OWN, ...FAB]);
  return rest.length === open.length ? open : rest; // the same list when nothing closes: no re-render, and a tool panel keeps its state
} // while placing a pin the tap only sets the pin (v3 `+page.svelte:2388`, `isEditingLocation`)

/** Zuletzt stands beside an open detail: on a desktop it moves left of the 450 px panel (v3 `besideDetail`). */
export const detailOpen = (open: Panels): boolean =>
  open.includes('recent') && OWN.some((s) => open.includes(s));
