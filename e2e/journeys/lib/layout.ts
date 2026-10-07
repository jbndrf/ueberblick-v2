import type { Page } from '@playwright/test';

/** v3 switches layout at 768 px (reference/src/routes/(participant)/map/+page.svelte:2428). */
export const LAYOUT_BREAKPOINT_PX = 768;

/** Test-only; not a domain value. */
export type Layout = 'phone' | 'desktop';

/**
 * Which v3 layout the page is in, from its viewport: `phone` is the bottom bar plus bottom sheet, `desktop` the header
 * icons plus the right panel (also tablets). The one place a journey asks; no ad-hoc viewport checks in specs.
 */
export function layout(page: Page): Layout {
  const width = page.viewportSize()?.width;
  if (width === undefined) throw new Error('layout: the page has no viewport');
  return width < LAYOUT_BREAKPOINT_PX ? 'phone' : 'desktop';
}
