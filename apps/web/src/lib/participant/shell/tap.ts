/**
 * WCAG 2.5.5 (WP-656): a control whose v3 look is smaller than 44 px keeps that look and gets a taller hit area from an
 * invisible pseudo-element. Tailwind reads these literals, so they stay whole strings.
 */
/** A 36 px icon button (the kit's `size="icon"`) answers taps over 44 px height. */
export const TAP_ICON = "relative after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']";
