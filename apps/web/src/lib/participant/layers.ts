/**
 * The participant shell's one layer order, bottom to top. Every overlay of the shell takes its z-index from here and
 * nowhere else (`layers.spec.ts` fails on a literal `z-[NNNN]` outside this file). The values are v3's, which stacked
 * them in the same order (bottom bar 1060, picker backdrop 1050 and pills 1100, detail `ModuleShell` 1200, Zuletzt
 * beside it 1201, menus 1300, chat and dialogs 9999); two things differ from v3 and are the point of WP-709: the
 * picker's backdrop leaves the header and Zuletzt alone (so the second + and a Zuletzt row are hit, not the backdrop),
 * and Einstellungen / Werkzeuge sit above the detail (v3 left them behind it; WP-829: on a phone too, so the language can be switched with a form open).
 *
 * Class names are written out in full so that Tailwind sees them. The detail panel (`ModuleShell`, packages/ui) keeps
 * its own `z-[1200]`; `DETAIL` is that number, and the spec keeps the two equal.
 */
export const DETAIL = 1200;

export const LAYER = {
  /** Controls on the map (Liste). */
  mapControl: 'z-10',
  /** The picker's transparent backdrop: closes the picker on a tap beside it. On a desktop it starts below the header (`md:top-[var(--ub-header-h)]`), so the header's + and Zuletzt take taps. */
  pickerBackdrop: 'z-[1050]',
  /** Zuletzt while the picker is open: above the backdrop, so its rows take taps (v3 had the backdrop over it). */
  recent: 'z-[1055]',
  /** The bottom bar: above the backdrop, so the second + is hit. */
  bar: 'z-[1060]',
  /** The skip link, while focused. */
  skip: 'focus:z-[1070]',
  /** The picker's pills, the pin and parent pills, the chain toggle. */
  pill: 'z-[1100]',
  /** The download card; the same plane as the detail. */
  card: 'z-[1200]',
  /** Zuletzt beside an open detail (desktop): left of it and above it (v3 `besideDetail`). */
  recentBesideDetail: 'md:z-[1201]',
  /** Einstellungen and Werkzeuge, on a phone and a desktop: above the detail (an open form too), which would otherwise hide them. */
  panel: 'z-[1210]',
  /** Dropdown menus (the relation path, the sheet's menu) and the error toast. */
  menu: 'z-[1300]',
  /** The chat panel (v3 `ChatSheet`) and the consent dialog. */
  top: 'z-[9999]',
} as const;

/**
 * The header height, defined once (`--ub-header-h`): the header, the picker backdrop, the list overlay and the chain-link
 * controls use it. The draw controls sit 1rem below it (v3 `geometry-draw-tool.svelte:709-720`: `top: 1rem` of the map).
 */
export const HEADER_VARS = '--ub-header-h:3.5rem;--ub-draw-top:calc(var(--ub-header-h) + 1rem)';
