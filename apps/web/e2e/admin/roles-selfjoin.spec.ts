import { expect, test, type Page } from '@playwright/test';
import { goldenData, goldenFile } from '../golden';
import { admin, createAdmin, signInAs } from './sign-in';

/**
 * WP-367: v3's Selbstbeitritt switch and join dialog on the Rollen page against the real built process, at phone
 * (390x844) and desktop (1280x800) size: the switch makes `/join/<slug>` work at once, off makes it refuse at once, on
 * again keeps the slug; the dialog shows the URL (copy with v3's toast), the defaults and the quota, and a quota saved
 * there goes into the draft and brings the publish bar.
 */
const TEMPLATE = goldenFile('templates/maengelmelder/1.0.0.yaml');
const KEY = 'beitrittstadt';
const PAGE = `/admin/projects/${KEY}/roles`;
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

test.use({ locale: 'de-DE', permissions: ['clipboard-read', 'clipboard-write'] });

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', KEY, 'Beitritt Stadt']).status).toBe(0);
  createAdmin('beitritt-deploy@example.org');
  expect(admin(['add-membership', 'beitritt-deploy@example.org', KEY, 'sachbearbeiter']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'beitritt-deploy@example.org', password: 'correct horse battery' },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: goldenData('projects/stadtwerke-meldungen.yaml'),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `beitritt${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, KEY, 'sachbearbeiter']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

const rowOf = (page: Page, name: string) => page.getByRole('row', { name: new RegExp(name) });

async function rowAction(page: Page, name: string, item: string): Promise<void> {
  await rowOf(page, name).getByRole('button', { name: 'Menü öffnen' }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

/** A role made through the page's own route (the same call the add row makes). */
async function makeRole(page: Page, name: string): Promise<void> {
  const status = await page.evaluate(
    async ([url, role]) =>
      (
        await fetch(url as string, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'create', name: role }),
        })
      ).status,
    [PAGE, name],
  );
  expect(status).toBe(201);
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('journey: switch on, open the dialog, copy the URL, set a quota, switch off and on again', async ({
      page,
      baseURL,
    }) => {
      await signIn(page);
      await page.goto(PAGE);
      const role = `Beitretende ${size.name}`;
      await makeRole(page, role);
      await page.reload();
      const row = rowOf(page, role);
      const toggle = row.getByRole('switch', { name: 'Selbstbeitritt' });
      await expect(page.getByRole('columnheader', { name: /Selbstbeitritt/ })).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');

      // The dialog needs the link on first (v3).
      await rowAction(page, role, 'Beitritts-URL & Voreinstellungen anzeigen');
      await expect(
        page.getByText('Aktivieren Sie zuerst den Selbstbeitritt, um eine URL zu erhalten'),
      ).toBeVisible();

      // On: applies at once and is no draft change.
      await toggle.click();
      await expect(page.getByText('Selbstbeitritt aktiviert')).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');

      await rowAction(page, role, 'Beitritts-URL & Voreinstellungen anzeigen');
      const dialog = page.getByRole('dialog', { name: /Selbstbeitritts-Link/ });
      const url = await dialog.getByLabel('Beitritts-URL').inputValue();
      expect(url).toMatch(/\/join\/[a-z0-9-]{3,64}$/);
      const slug = url.slice(url.lastIndexOf('/') + 1);
      const box = await dialog.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= size.width).toBe(true);
      await expect(dialog.getByText('Voreinstellungen beim Selbstbeitritt')).toBeVisible();
      await expect(dialog.getByText('90 Tagen Inaktivität')).toBeVisible();

      // The URL works at once: a visitor reaches the join page.
      const visitor = await page
        .context()
        .browser()
        ?.newContext({ baseURL: baseURL ?? '' });
      const open = await visitor?.request.get(`/join/${slug}`);
      expect(open?.status()).toBe(200);

      // Kopieren puts the URL on the clipboard with v3's toast.
      await dialog.getByRole('button', { name: 'Kopieren' }).click();
      await expect(page.getByText('Beitritts-URL in die Zwischenablage kopiert')).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

      // The quota is config: Speichern writes the draft and the publish bar comes.
      await dialog.getByLabel(/Max\. Arbeitsabläufe/).fill('5');
      await dialog.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('Kontingent im Entwurf gespeichert')).toBeVisible();
      await expect(page.getByTestId('publish-bar')).toBeVisible();
      await dialog.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Schließen' }).click();

      // Off refuses at once; on again keeps the slug.
      await toggle.click();
      await expect(page.getByText('Selbstbeitritt deaktiviert')).toBeVisible();
      expect((await visitor?.request.get(`/join/${slug}`))?.status()).toBe(404);
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      expect((await visitor?.request.get(`/join/${slug}`))?.status()).toBe(200);
      await visitor?.close();
    });
  });
}
