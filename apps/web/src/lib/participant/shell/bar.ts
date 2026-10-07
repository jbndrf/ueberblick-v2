/**
 * The bottom bar and the header icons of v3's map screen, as data (`BottomControlBar.svelte:66-142`,
 * `+layout.svelte:539-646`). The bar is the owner's plain core map: Layer, Filter, +, Standort, Werkzeuge,
 * Einstellungen, in this order. Werkzeuge exists only while the person has an active tool (`tools/entries.ts`: the
 * role's availability and the person's switch decide, nothing is hard-coded per role).
 */

export const BAR_ITEMS = ['layers', 'filter', 'create', 'location', 'tools', 'settings'] as const;
export type BarItem = (typeof BAR_ITEMS)[number];

/** The bar's buttons in v3's order; `tools` only when a tool is active. */
export function barItems(opts: { readonly toolsActive: boolean }): readonly BarItem[] {
  return BAR_ITEMS.filter((item) => item !== 'tools' || opts.toolsActive);
}

/**
 * The + button cycles (`BottomControlBar.svelte:49-58`): closed (0), the picker (1), the picker with the recent sheet
 * beside it (2), closed again.
 */
export type FabStep = number;
const FAB_STEPS = 3;
export const nextFab = (step: FabStep): FabStep => (step + 1) % FAB_STEPS;
/** The rotation of the + icon in degrees (v3 `fabRotation`). */
export const fabRotation = (step: FabStep): number => (step === 2 ? 90 : step === 1 ? 45 : 0);
