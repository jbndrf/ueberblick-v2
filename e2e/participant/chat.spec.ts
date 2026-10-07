import { expect, test, type Page } from '@playwright/test';
import { openDevice } from './two-devices';
import { seedWorld } from './world';

/**
 * WP-684: the Projekt-Chat on two devices of one project. Role `kontrolle` has the chat (map-world). Device A sends,
 * device B (open, no reload) shows it after the tool doorbell; a message sent while B is offline arrives when it is
 * back; the person picker lists the project's chat members from the server; the panel stays open under Layer.
 * Both devices sign in as the same participant, so the message is B's own ("You") and counts no unread.
 */
const LIMIT_MS = 5_000;

test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
});

/** Werkzeuge -> Project chat: the tile sits in the right-hand sheet, the panel opens beside the map. */
async function openChat(page: Page) {
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Tools', exact: true })
    .getByRole('button', { name: /Project chat/ })
    .click();
  const panel = page.getByRole('dialog', { name: 'Project chat' });
  await expect(panel).toBeVisible();
  return panel;
}

test('a message sent on device A shows on device B after the doorbell, and again after B was offline', async ({
  browser,
  baseURL,
}) => {
  const a = await openDevice(browser, baseURL ?? '');
  const b = await openDevice(browser, baseURL ?? '');
  const first = `Hallo ${Date.now()}`;
  const second = `Später ${Date.now()}`;
  try {
    const panelA = await openChat(a.page);
    const panelB = await openChat(b.page);
    await panelA.getByRole('textbox', { name: 'Write a message' }).fill(first);
    await panelA.getByRole('button', { name: 'Send' }).click();
    await expect(panelA.getByText(first)).toBeVisible();
    await expect(panelB.getByText(first)).toBeVisible({ timeout: LIMIT_MS });

    await b.context.setOffline(true);
    await panelA.getByRole('textbox', { name: 'Write a message' }).fill(second);
    await panelA.getByRole('button', { name: 'Send' }).click();
    await expect(panelA.getByText(second)).toBeVisible();
    await a.page.waitForTimeout(1_500);
    await expect(panelB.getByText(second)).toHaveCount(0);
    await b.context.setOffline(false);
    await expect(panelB.getByText(second)).toBeVisible({ timeout: LIMIT_MS });
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test('the person picker lists the project members the server named, and the panel stays open under Layer', async ({
  browser,
  baseURL,
}) => {
  const a = await openDevice(browser, baseURL ?? '');
  try {
    const panel = await openChat(a.page);
    const picker = panel.getByRole('combobox', { name: /Mention someone/ });
    await expect(picker.locator('option')).toHaveCount(2, { timeout: 10_000 }); // the hint and Berta
    await expect(picker.locator('option').nth(1)).toHaveText('Berta');
    // v3: the chat is its own flag; Layer, Filter and Settings do not close it
    await a.page.getByRole('button', { name: /Layers/ }).click();
    await expect(a.page.getByRole('dialog', { name: 'Map layers' })).toBeVisible();
    await expect(panel).toBeVisible();
    await a.page.keyboard.press('Escape'); // the Layer sheet is modal: close it, then the next one
    await expect(a.page.getByRole('dialog', { name: 'Map layers' })).toBeHidden();
    await expect(panel).toBeVisible();
    await a.page.getByRole('button', { name: /Settings/ }).click();
    await expect(a.page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await expect(panel).toBeVisible();
  } finally {
    await a.context.close();
  }
});
