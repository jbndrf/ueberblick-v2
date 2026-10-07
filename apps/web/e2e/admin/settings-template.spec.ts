import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { goldenData, goldenFile } from '../golden';
import { admin, createAdmin, signInAs } from './sign-in';

/**
 * WP-448: Projekteinstellungen, section "Vorlage" (engine-new), at phone (390x844) and desktop (1280x800) size: the
 * template and its version, and the template's input saved into the draft (overlay `inputs`) and shown again after a reload.
 */
const TEMPLATE = goldenFile('templates/maengelmelder/1.0.0.yaml');
const KEY = 'vorlagenstadt';
const PAGE = `/admin/projects/${KEY}/settings?section=template`;
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

// WP-489 (479, 484): a test-only template that declares a datetime, a multiselect and a localized_text input.
const RICH_KEY = 'vorlagenreich';
const RICH_PAGE = `/admin/projects/${RICH_KEY}/settings?section=template`;
function richTemplateFile(): string {
  const data = goldenData('templates/maengelmelder/1.0.0.yaml') as Record<string, unknown>;
  const template: Record<string, unknown> = { ...data, template: { key: 'vorlagetest', version: '1.0.0' } };
  template.inputs = {
    ...(data.inputs as Record<string, unknown>),
    stichtag: { type: 'datetime', label: { de: 'Stichtag', en: 'Cut-off' } },
    kanaele: {
      type: 'multiselect',
      options: { mail: { de: 'E-Mail', en: 'Email' }, post: { de: 'Brief', en: 'Letter' } },
      label: { de: 'Kanäle', en: 'Channels' },
    },
    hinweis: { type: 'localized_text', label: { de: 'Hinweistext', en: 'Notice' } },
  };
  const path = join(mkdtempSync(join(tmpdir(), 'ub-e2e-rich-')), 'vorlagetest.json');
  writeFileSync(path, JSON.stringify(template));
  return path;
}

test.use({ locale: 'de-DE' });
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', KEY, 'Vorlagen Stadt']).status).toBe(0);
  createAdmin('vorlage-deploy@example.org');
  expect(admin(['add-membership', 'vorlage-deploy@example.org', KEY, 'sachbearbeiter']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'vorlage-deploy@example.org', password: 'correct horse battery' },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: goldenData('projects/stadtwerke-meldungen.yaml'),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();

  // The rich project: its own template and project.
  expect(admin(['create-project', RICH_KEY, 'Vorlagen Reich']).status).toBe(0);
  expect(admin(['add-membership', 'vorlage-deploy@example.org', RICH_KEY, 'sachbearbeiter']).status).toBe(0);
  expect(admin(['publish-template', richTemplateFile()]).status).toBe(0);
  const rich = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  expect(
    (
      await rich.post('/api/auth/login', {
        data: { email: 'vorlage-deploy@example.org', password: 'correct horse battery' },
      })
    ).status(),
  ).toBe(200);
  const overlay = goldenData('projects/stadtwerke-meldungen.yaml') as Record<string, unknown>;
  const richDeploy = await rich.post(`/api/admin/p/${RICH_KEY}/deploy`, {
    data: { ...overlay, extends: 'vorlagetest@1' },
  });
  expect(await richDeploy.json()).toMatchObject({ ok: true });
  await rich.dispose();
});

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('shows the template and version, saves an input into the draft and shows it after a reload', async ({
      page,
    }) => {
      const email = `vorlage-${size.name}@example.org`;
      createAdmin(email);
      expect(admin(['add-membership', email, KEY, 'sachbearbeiter']).status).toBe(0);
      await signInAs(page, email);
      await expect(page).toHaveURL(/\/admin\/projects/);
      await page.goto(PAGE);

      await expect(page.getByRole('heading', { level: 2, name: 'Vorlage' })).toBeVisible();
      await expect(page.getByTestId('template-summary')).toContainText('1.0.0');
      const field = page.getByLabel('Eskalation nach (Tagen)');
      await expect(field).toBeVisible();
      const value = size.name === 'phone' ? '5' : '9';
      await field.fill(value);
      await page.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('Eingaben gespeichert')).toBeVisible();
      await expect(page.getByTestId('publish-bar')).toBeVisible();

      await page.reload();
      await expect(page.getByLabel('Eskalation nach (Tagen)')).toHaveValue(value);
    });

    test('saves a datetime, a multiselect and a localized text input and shows them after a reload', async ({
      page,
    }) => {
      const email = `vorlage-reich-${size.name}@example.org`;
      createAdmin(email);
      expect(admin(['add-membership', email, RICH_KEY, 'sachbearbeiter']).status).toBe(0);
      await signInAs(page, email);
      await expect(page).toHaveURL(/\/admin\/projects/);
      await page.goto(RICH_PAGE);

      // The project is shared by both sizes, so each size picks its own channel (picking one again would clear it).
      const channel = size.name === 'phone' ? 'Brief' : 'E-Mail';
      const when = size.name === 'phone' ? '2027-03-04T08:15' : '2027-05-06T17:45';
      await page.getByLabel('Stichtag').fill(when);
      await page.getByLabel('Hinweistext (Deutsch)').fill(`Hallo ${size.name}`);
      await page.getByLabel('Hinweistext (English)').fill(`Hello ${size.name}`);
      await page.locator('#template-input-kanaele').click();
      // v3's MultiSelect is a dropdown on desktop and a full-screen dialog on a phone (rows are checkboxes).
      const dialog = page.getByRole('dialog', { name: 'Optionen auswählen' });
      await page
        .getByRole('option', { name: channel })
        .or(dialog.getByRole('checkbox', { name: channel }))
        .click();
      if (await dialog.isVisible()) await dialog.getByRole('button', { name: /^Fertig/ }).click();
      else await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('Eingaben gespeichert')).toBeVisible();

      await page.reload();
      await expect(page.getByLabel('Stichtag')).toHaveValue(when);
      await expect(page.getByLabel('Hinweistext (Deutsch)')).toHaveValue(`Hallo ${size.name}`);
      await expect(page.getByLabel('Hinweistext (English)')).toHaveValue(`Hello ${size.name}`);
      await expect(page.locator('#template-input-kanaele')).toContainText(channel);
    });
  });
}
