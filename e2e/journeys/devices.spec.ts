import { expect, test } from '@playwright/test';
import { openDevice } from './lib/devices';
import { layout } from './lib/layout';
import { seedJourneyWorld } from './lib/world';

/**
 * A second device of the journey's project (WP-950): the journeys helper opens it with the project's device, so a
 * multi-device journey sees the same layout on both devices (docs/process/v3-journeys.md).
 */
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedJourneyWorld(playwright, baseURL ?? '');
});

/** Harness proof for WP-950: a second device opened via the helper presents the project's device. */
test('a second device presents the project device', async ({ browser, baseURL, isMobile, hasTouch }) => {
  const { context, page } = await openDevice(browser, baseURL ?? '');
  try {
    expect(layout(page)).toBe(isMobile ? 'phone' : 'desktop');
    const size = page.viewportSize();
    const touchPoints = await page.evaluate(() => navigator.maxTouchPoints);
    if (isMobile) {
      expect(size?.width).toBeLessThan(768);
      expect(hasTouch).toBe(true);
      expect(touchPoints).toBeGreaterThan(0);
    } else {
      expect(size).toEqual({ width: 1280, height: 800 });
      expect(touchPoints).toBe(0);
    }
  } finally {
    await context.close();
  }
});
