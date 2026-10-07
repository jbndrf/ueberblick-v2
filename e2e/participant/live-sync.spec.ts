import { expect, test } from '@playwright/test';
import { FINDING } from './map-world';
import { latencyUntil, openDevice, openTreeSheet, restoreFinding, submitFinding } from './two-devices';
import { seedWorld } from './world';

/**
 * WP-944: live collaboration. Two devices of one project; A submits a task, B (already open on the feature, no reload,
 * no interaction) shows the change within 5 s. B is read through the feature sheet, which both the old shell and the
 * ported one keep. The latency is printed as `LATENCY <case> <ms>` for the log.
 */
const LIMIT_MS = 5_000;

test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
});

test('a task submitted on device A shows on device B without a reload', async ({ browser, baseURL }) => {
  const a = await openDevice(browser, baseURL ?? '');
  const b = await openDevice(browser, baseURL ?? '');
  const text = `Live ${Date.now()}`;
  try {
    const sheetB = await openTreeSheet(b.page);
    await openTreeSheet(a.page);
    await submitFinding(a.page, text);
    const ms = await latencyUntil(() => sheetB.getByText(text).isVisible(), LIMIT_MS);
    console.log(`LATENCY online ${ms}`);
    expect(ms).toBeLessThan(LIMIT_MS);
  } finally {
    await restoreFinding(a.page, FINDING);
    await a.context.close();
    await b.context.close();
  }
});

test('device B comes back online and shows what A changed meanwhile', async ({ browser, baseURL }) => {
  const a = await openDevice(browser, baseURL ?? '');
  const b = await openDevice(browser, baseURL ?? '');
  const text = `Offline ${Date.now()}`;
  try {
    const sheetB = await openTreeSheet(b.page);
    await openTreeSheet(a.page);
    await b.context.setOffline(true);
    await submitFinding(a.page, text);
    // while offline B must not know yet
    await a.page.waitForTimeout(1_500);
    await expect(sheetB.getByText(text)).toHaveCount(0);
    await b.context.setOffline(false);
    const ms = await latencyUntil(() => sheetB.getByText(text).isVisible(), LIMIT_MS);
    console.log(`LATENCY reconnect ${ms}`);
    expect(ms).toBeLessThan(LIMIT_MS);
  } finally {
    await restoreFinding(a.page, FINDING);
    await a.context.close();
    await b.context.close();
  }
});
