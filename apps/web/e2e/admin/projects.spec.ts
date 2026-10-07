import { expect, test, type Page } from '@playwright/test';
import { scan } from '../../../../e2e/a11y/axe';
import { goldenFile } from '../golden';
import { admin, createAdmin, signInAs } from './sign-in';

/** WP-323: the Projekte page and "Projekt erstellen" (v3's flow, with the template select of Q10). */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');

test.use({ bypassCSP: true, locale: 'de-DE' });

test.beforeAll(() => {
  createAdmin('projekte@example.org');
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
});

async function signIn(page: Page): Promise<void> {
  await signInAs(page, 'projekte@example.org');
}

test('journey: empty Projekte, create from a template, land on Teilnehmende, back to the card', async ({
  page,
}) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/admin\/projects$/);
  await expect(page.getByRole('heading', { name: 'Projekte' })).toBeVisible();
  await expect(page.getByText('Keine Projekte gefunden.')).toBeVisible();
  expect(await scan(page)).toEqual([]);

  await page.getByRole('link', { name: 'Projekt erstellen' }).first().click();
  await expect(page).toHaveURL(/\/admin\/projects\/new$/);
  const select = page.getByLabel('Vorlage');
  await expect(select.locator('option').first()).toHaveText('Leeres Projekt');
  expect(await scan(page)).toEqual([]);

  // v3's error for an empty name
  await page.getByRole('button', { name: 'Projekt erstellen' }).click();
  await expect(page.getByText('Der Name ist erforderlich')).toBeVisible();

  await page.getByLabel('Projektname').fill('Baumkataster Nord');
  await page.getByLabel('Beschreibung').fill('Die Bäume im Norden');
  await select.selectOption('baumkataster@1');
  await page.getByRole('button', { name: 'Projekt erstellen' }).click();
  await expect(page).toHaveURL(/\/admin\/projects\/baumkataster_nord\/participants$/);
  await expect(page.getByRole('heading', { name: 'Teilnehmende' })).toBeVisible();

  await page.locator('[data-slot="sidebar"]').getByRole('link', { name: 'Projekte', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/projects$/);
  await expect(page.getByText('Baumkataster Nord', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Die Bäume im Norden')).toBeVisible();
  expect(await scan(page)).toEqual([]);
  await page.getByRole('link', { name: 'Projekt öffnen' }).click();
  await expect(page).toHaveURL(/\/admin\/projects\/baumkataster_nord\/participants$/);
});
