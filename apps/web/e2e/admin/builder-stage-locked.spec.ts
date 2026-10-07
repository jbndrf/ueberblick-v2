import { expect, test } from '@playwright/test';
import { goldenFile } from '../golden';
import { admin, createAdmin, signInAs, uniqueEmail } from './sign-in';

/**
 * WP-515: on a template that locks the stage options (Baumkataster, Baum) the "Phase" chip is disabled with
 * "Von der Vorlage gesperrt" and no engine text is reachable; on a phone the sidebar sheet closes after
 * "Neue Objektart" (v3 closed its sidebar on navigation). Phone (390x844) and desktop (1280x800).
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

    test('journey: locked Phase chip says why; the phone sidebar closes after Neue Objektart', async ({
      page,
    }) => {
      const email = uniqueEmail(`stagelock-${size.name}`);
      createAdmin(email);
      await signInAs(page, email);
      await expect(page).toHaveURL(/\/admin\/projects/);
      await page.goto('/admin/projects/new');
      await page.getByLabel('Projektname').fill(`Sperre ${size.name}`);
      await page.getByLabel('Vorlage').selectOption('baumkataster@1');
      await page.getByRole('button', { name: 'Projekt erstellen' }).click();
      const project = `sperre_${size.name}`;
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${project}/participants$`));

      // The locked Phase chip of Baum.
      await page.goto(`/admin/projects/${project}/types/baum/builder`);
      const frame = page.getByTestId('builder-frame');
      if (size.name === 'phone') await frame.getByTestId('open-catalog').click();
      const chip = page.getByRole('button', { name: 'Phase', exact: true });
      await expect(chip).toBeDisabled();
      await expect(chip).toHaveAttribute('title', 'Von der Vorlage gesperrt');
      await expect(page.getByText('The template locks')).toHaveCount(0);
      if (size.name === 'phone') await page.keyboard.press('Escape');

      // A new Objektart: at phone size the sidebar sheet is closed once its builder is open.
      if (!(await page.getByTestId('group-types').isVisible())) {
        await page.getByRole('button', { name: 'Seitenleiste umschalten' }).click();
      }
      await page.getByTestId('group-types').getByRole('button', { name: 'Objektart hinzufügen' }).click();
      await page.getByRole('menuitem', { name: 'Neue Objektart' }).click();
      await page.getByTestId('new-type-name').fill('Spielplatz');
      await page.getByTestId('new-type-create').click();
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${project}/types/spielplatz/builder$`));
      if (size.name === 'phone') {
        await expect(page.getByTestId('group-types')).toBeHidden();
        await expect(page.getByTestId('builder-frame')).toBeVisible();
      }
    });
  });
}
