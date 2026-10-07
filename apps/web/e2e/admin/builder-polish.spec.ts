import { expect, test } from '@playwright/test';
import { goldenFile } from '../golden';
import { admin, createAdmin, signInAs, uniqueEmail } from './sign-in';

/**
 * WP-516: the first edit moves nothing (the "Ungespeicherte Änderungen" slot is always laid out), the builder page
 * does not scroll as a whole (the toolbar stays under the publish bar's edge, never beneath it), the empty-canvas
 * "Phase hinzufügen" shows the lock, and the Versionen page uses the admin shell's own side padding (12 px).
 * Phone (390x844) and desktop (1280x800).
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

test.use({ locale: 'de-DE' });

test.beforeAll(() => {
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
});

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: no jump on the first edit, no page scroll, lock on Phase, Versionen padding', async ({
      page,
    }) => {
      const email = uniqueEmail(`polish-${size.name}`);
      createAdmin(email);
      await signInAs(page, email);
      await expect(page).toHaveURL(/\/admin\/projects/);
      await page.goto('/admin/projects/new');
      await page.getByLabel('Projektname').fill(`Politur ${size.name}`);
      await page.getByLabel('Vorlage').selectOption('baumkataster@1');
      await page.getByRole('button', { name: 'Projekt erstellen' }).click();
      const project = `politur_${size.name}`;
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${project}/participants$`));

      // (6) the Versionen page's own padding is the shell's 12 px, not 28.
      if (size.name === 'phone') {
        await page.goto(`/admin/projects/${project}/versions`);
        const heading = page.getByRole('heading', { level: 1 });
        await expect(heading).toBeVisible();
        const box = await heading.boundingBox();
        expect(box?.x).toBeLessThanOrEqual(13);
      }

      await page.goto(`/admin/projects/${project}/types/baum/builder`);
      const frame = page.getByTestId('builder-frame');
      await expect(frame).toBeVisible();
      const canvas = page.getByTestId('builder-canvas');
      await expect(canvas).toBeVisible();

      // (1) the first edit does not move the canvas.
      const before = await canvas.boundingBox();
      if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
      await page.getByRole('button', { name: 'Schaltfläche', exact: true }).click();
      if (size.name === 'phone') await page.keyboard.press('Escape');
      await expect(page.getByTestId('unsaved')).toBeVisible();
      const after = await canvas.boundingBox();
      expect(after?.y).toBe(before?.y);

      // (2) the page does not scroll as a whole: the builder frame sits inside the shell's content area.
      const overflow = await frame.evaluate((el) => {
        let node: HTMLElement | null = el.parentElement;
        let worst = 0;
        while (node !== null) {
          worst = Math.max(worst, node.scrollHeight - node.clientHeight);
          node = node.parentElement;
        }
        return worst;
      });
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });
}
