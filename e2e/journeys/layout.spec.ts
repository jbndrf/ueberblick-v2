import { expect, test } from '@playwright/test';
import { layout } from './lib/layout';

/** Harness proof for WP-950: the `phone` and `desktop` projects have the viewports v3's layouts need. */
test('the project has the viewport and input of its layout', async ({ page, isMobile, hasTouch }, testInfo) => {
  const size = page.viewportSize();
  expect(testInfo.project.name).toBe(layout(page));
  if (layout(page) === 'phone') {
    expect(size?.width).toBeLessThan(768);
    expect(isMobile).toBe(true);
    expect(hasTouch).toBe(true);
  } else {
    expect(size).toEqual({ width: 1280, height: 800 });
    expect(isMobile).toBe(false);
  }
});
