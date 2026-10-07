import { expect, type Page } from '@playwright/test';

/**
 * The one publish flow of the admin e2e specs (WP-409). Since WP-360 both the publish bar and the section
 * "Status & Freigabe" open the deploy overview; its "Veröffentlichen" deploys, and the toast "Version n ist live"
 * follows. If the deploy does not go through, the error carries the answer and the status route's reason.
 */
export type PublishVia = 'bar' | 'lifecycle';

export async function publish(page: Page, opts: { via: PublishVia }): Promise<void> {
  const trigger = opts.via === 'bar' ? page.getByTestId('publish-bar') : page.getByTestId('settings-section');
  await trigger.getByRole('button', { name: 'Veröffentlichen' }).click();
  const deployed = page.waitForResponse(
    (r) => r.url().includes('/deploy') && r.request().method() === 'POST',
  );
  await page.getByTestId('deploy-overview').getByRole('button', { name: 'Veröffentlichen' }).click();
  const answer = await (await deployed).text();
  try {
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: /Version \d+ ist live/ })
        .first(),
    ).toBeVisible();
  } catch (e) {
    const key = /\/admin\/projects\/([^/?#]+)/.exec(page.url())?.[1] ?? '';
    const status = await page.request.get(`/api/admin/p/${key}/draft/status`);
    throw new Error(`publish refused: ${answer} | ${await status.text()}`, { cause: e });
  }
  if (opts.via === 'bar') await expect(page.getByTestId('publish-bar')).toBeHidden();
}
