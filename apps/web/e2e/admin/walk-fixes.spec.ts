import { expect, test } from '@playwright/test';
import { goldenFile } from '../golden';
import { admin, createAdmin, signInAs, uniqueEmail } from './sign-in';

/** WP-498 bug hunt: a direct load of the API-Zugang section renders on the server; the Daten header actions stay reachable on a phone. */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

test.use({ locale: 'de-DE' });

for (const size of SIZES) {
  test(`${size.name}: API-Zugang loads directly; Daten header actions are inside the viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
    const email = uniqueEmail('walkfix');
    createAdmin(email);
    await signInAs(page, email);
    await page.waitForURL(/admin\/projects/);
    await page.goto('/admin/projects/new');
    await page.getByLabel('Projektname').fill(`Walkfix ${size.name}`);
    await page.getByLabel('Vorlage').selectOption('baumkataster@1');
    await page.getByRole('button', { name: 'Projekt erstellen' }).click();
    await page.waitForURL(/participants$/);
    const key = `walkfix_${size.name}`;

    const res = await page.goto(`/admin/projects/${key}/settings?section=api-tokens`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Token erstellen' })).toBeVisible();

    await page.goto(`/admin/projects/${key}/types/baum`);
    for (const name of ['Builder', 'Aktualisieren']) {
      const box = await page
        .getByRole('link', { name })
        .or(page.getByRole('button', { name }))
        .first()
        .boundingBox();
      expect(box).not.toBeNull();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(size.width);
    }
  });
}
