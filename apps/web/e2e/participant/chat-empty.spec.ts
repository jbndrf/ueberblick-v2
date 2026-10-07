import { devices, expect } from '@playwright/test';
import { test } from './helpers/step5-world';
import { seedEmptyChat, signInEmptyChat } from './helpers/empty-chat-world';
import { E2E_PORT } from '../../playwright.config';

/**
 * WP-857 (WP-856 verify later): a project with the chat on and no message shows "Noch keine Nachrichten" in the
 * open Projekt-Chat, visibly and with room (v3 `ChatSheet.svelte`, empty state). Phone and desktop.
 */
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });
test.setTimeout(90_000);

for (const size of ['phone', 'desktop'] as const) {
  test.describe(size, () => {
    if (size === 'desktop')
      test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

    test('Projekt-Chat without messages: the empty state is on screen', async ({
      page,
      playwright,
      world,
    }, info) => {
      void world; // publishes the template step5@1
      await seedEmptyChat(playwright, `http://localhost:${E2E_PORT}`);
      await signInEmptyChat(page, `p-leer-${size}-${info.repeatEachIndex}-${info.retry}`);
      await page.getByRole('button', { name: 'Werkzeuge' }).click();
      await page.getByRole('button', { name: /Projekt-Chat/ }).click();
      const log = page.getByRole('log', { name: 'Nachrichten' });
      await expect(log).toBeVisible();
      const empty = log.getByText('Noch keine Nachrichten');
      await expect(empty).toBeVisible();
      await expect(empty).toBeInViewport();
      expect((await log.boundingBox())?.height ?? 0).toBeGreaterThan(40);
    });
  });
}
