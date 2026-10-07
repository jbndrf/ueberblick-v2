/** Two devices of one project: two browser contexts, each an empty device (own IndexedDB, own session), both signed in. */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { signInByLink } from './world';

export interface Device {
  readonly context: BrowserContext;
  readonly page: Page;
}

/**
 * The current project's device (WP-950): the second device presents the project's device explicitly, so a multi-device
 * journey sees the same layout on both devices regardless of the runner's context merging (docs/process/v3-journeys.md).
 */
function projectDeviceOptions() {
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = test.info().project.use;
  return { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor };
}

export async function openDevice(browser: Browser, baseURL: string): Promise<Device> {
  const context = await browser.newContext({ baseURL, locale: 'de-DE', ...projectDeviceOptions() });
  const page = await context.newPage();
  await signInByLink(page);
  return { context, page };
}

export async function twoDevices(browser: Browser, baseURL: string): Promise<readonly [Device, Device]> {
  return [await openDevice(browser, baseURL), await openDevice(browser, baseURL)];
}
