import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { goldenFile } from '../golden';
import { PASSWORD, admin, createAdmin, signInAs } from './sign-in';

/**
 * WP-330: the Objektart's builder frame. The spec signs in at /admin/login (WP-320) and opens the
 * builder inside the admin shell.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const URL_OF = (type: string): string => `/admin/projects/shellstadt/types/${type}/builder`;

test.use({ locale: 'de-DE' });

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', 'shellstadt', 'Shell Stadt']).status).toBe(0);
  createAdmin('shelldeploy@example.org');
  expect(admin(['add-membership', 'shelldeploy@example.org', 'shellstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'shelldeploy@example.org', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/shellstadt/deploy', {
    data: parse(readFileSync(OVERLAY, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `shell${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, 'shellstadt', 'verwaltung']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

test('anonymous is redirected to the sign-in; an unknown Objektart is 404', async ({ page }) => {
  const anonymous = await page.request.get(URL_OF('baum'), { maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);
  await signIn(page);
  expect((await page.request.get(URL_OF('gibtsnicht'))).status()).toBe(404);
});

test('journey: add a task, Speichern, reload, the task is there; the view stays in the address', async ({
  page,
}) => {
  await signIn(page);
  await page.goto(URL_OF('baum'));
  await expect(
    page.locator('[data-slot="sidebar"]').getByRole('link', { name: 'Projekte', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('builder-catalog')).toBeVisible();
  await expect(page.getByTestId('builder-center')).toBeVisible();
  await expect(page.getByTestId('builder-inspector')).toBeVisible();
  await expect(page.getByTestId('type-name')).toHaveValue('Baum');

  await page.getByTestId('builder-frame').getByRole('button', { name: 'Modell', exact: true }).click();
  await expect(page).toHaveURL(/[?&]view=model/);
  await page.reload();
  await expect(
    page.getByTestId('builder-frame').getByRole('button', { name: 'Modell', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('builder-frame').getByRole('button', { name: 'Workflow', exact: true }).click();
  await expect(page).toHaveURL(/[?&]view=workflow/);

  await page.getByTestId('builder-frame').getByRole('button', { name: 'Schaltfläche', exact: true }).click();
  await expect(page.getByTestId('unsaved')).toBeVisible();
  await page.getByTestId('builder-frame').getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByTestId('unsaved')).toBeHidden();

  await page.reload();
  await expect(page.getByTestId('builder-catalog').getByText('Neue Aufgabe')).toBeVisible();
});

test('closing the page with unsaved changes asks first', async ({ page }) => {
  await signIn(page);
  await page.goto(URL_OF('baum'));
  await page.getByTestId('builder-frame').getByRole('button', { name: 'Formular', exact: true }).click();
  await expect(page.getByTestId('unsaved')).toBeVisible();
  const asked = page.waitForEvent('dialog');
  await page.close({ runBeforeUnload: true });
  const dialog = await asked;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.accept();
});

const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

for (const size of SIZES) {
  test.describe(`catalog at ${size.name} (${size.width}x${size.height})`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    // v3 `CatalogSidebar.svelte:131-166`: on a phone the catalog is a sheet that the toolbar opens
    const openCatalog = async (page: Page): Promise<void> => {
      if (size.name === 'phone') await page.getByTestId('builder-frame').getByTestId('open-catalog').click();
    };
    const closeCatalog = async (page: Page): Promise<void> => {
      if (size.name === 'phone') await page.keyboard.press('Escape');
    };

    test('chips "Eingang", "Schaltfläche" and "Formular" add an entry and two tasks', async ({ page }) => {
      await signIn(page);
      await page.goto(URL_OF('baum'));
      const canvas = page.getByTestId('builder-canvas');
      const entries = canvas.locator('.entry-node');
      const entryCount = await entries.count();
      await openCatalog(page);
      const catalog = page.getByTestId('builder-catalog');
      await catalog.getByRole('button', { name: 'Eingang', exact: true }).click();
      await closeCatalog(page);
      await expect(page.getByTestId('unsaved')).toBeVisible();
      await expect(entries).toHaveCount(entryCount + 1);
      await expect(canvas.getByText('Neuer Eingang')).toBeVisible();

      await openCatalog(page);
      const tasks = page.getByTestId('catalog-count-actions');
      const before = Number(await tasks.textContent());
      await catalog.getByRole('button', { name: 'Schaltfläche', exact: true }).click();
      await closeCatalog(page);
      await openCatalog(page);
      await expect(tasks).toHaveText(String(before + 1));
      await catalog.getByRole('button', { name: 'Formular', exact: true }).click();
      await closeCatalog(page);
      await openCatalog(page);
      await expect(tasks).toHaveText(String(before + 2));
    });

    test('inventories: Aufgaben with badges, Regeln with the trigger, Feldbibliothek', async ({ page }) => {
      await signIn(page);
      await page.goto(URL_OF('baum'));
      await openCatalog(page);
      const catalog = page.getByTestId('builder-catalog');
      // Aufgaben: the entry task has the badge "Eingang"; a task pinned to a phase shows the phase
      await expect(catalog.locator('[data-path="tasks.erfassen"]')).toContainText('Eingang');
      await expect(catalog.locator('[data-path="tasks.massnahme_anlegen"] .scope-badge')).toBeVisible();
      // Regeln (v3 "Automatisierungen"): the trigger kind beside the name
      await expect(
        catalog.locator('[data-path="tasks.massnahme_anlegen.auto.massnahme_bei_schaden"]'),
      ).toContainText('bei Aufgabe');
      await expect(
        catalog.locator('[data-path="tasks.system_faellig.auto.kontrolle_wird_faellig"]'),
      ).toContainText('nach Zeit');
      // Feldbibliothek: a heading with a count
      await expect(catalog.getByRole('heading', { name: 'Feldbibliothek' })).toBeVisible();
      await expect(catalog.getByTestId('catalog-count-fields')).not.toHaveText('0');
      // a click on a row opens its pane
      await catalog.locator('[data-path="tasks.massnahme_anlegen.auto.massnahme_bei_schaden"]').click();
      await expect(page.getByTestId('rule-pane')).toBeVisible();
    });
  });
}
