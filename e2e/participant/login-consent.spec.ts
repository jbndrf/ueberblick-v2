import { expect, test, type Page } from '@playwright/test';
import { createInstanceStore, openControlDb } from '@ueberblick/server';
import { issueToken, seedWorld } from './world';
import { PARTICIPANT_DATA_DIR } from './playwright.config';

/**
 * WP-638: the consent gate on `/login` and the public `/legal` pages in a real browser, at phone size (390x844) and
 * desktop size (1280x800), as v3 (which switches layout at 768 px). The instance settings are written straight into
 * control.db (the store the settings API writes to); the server reads them on every request.
 */
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;
const IN_APP = /\/(map|app)$/;

function instance<T>(fn: (store: ReturnType<typeof createInstanceStore>) => T): T {
  const control = openControlDb(`${PARTICIPANT_DATA_DIR}/control.db`);
  try {
    return fn(createInstanceStore(control, { now: () => new Date().toISOString() }));
  } finally {
    control.close();
  }
}

test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
  instance((s) => {
    s.saveSettings({
      requireConsent: true,
      consentTitle: '',
      consentBody: '',
      acceptLabel: '',
      rejectLabel: '',
    });
    s.savePage({
      slug: 'impressum',
      title: 'Impressum',
      body: '<h2>Betreiber</h2><p>Stadt Musterstadt</p>',
      sortOrder: 1,
      showInConsentFooter: true,
    });
    s.savePage({
      slug: 'datenschutz',
      title: 'Datenschutz',
      body: '<p>Wir speichern nichts.</p>',
      sortOrder: 2,
      showInConsentFooter: false,
    });
  });
});

test.afterAll(() => {
  instance((s) => {
    s.saveSettings({ ...s.settings(), requireConsent: false });
    s.removePage('impressum');
    s.removePage('datenschutz');
  });
});

/** No sideways scroll, and the box sits inside the viewport. */
async function fitsViewport(page: Page, selector?: string): Promise<void> {
  const size = page.viewportSize();
  if (size === null) throw new Error('no viewport');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (selector === undefined) return;
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error('no box');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(size.width);
  expect(box.y + box.height).toBeLessThanOrEqual(size.height);
}

for (const vp of VIEWPORTS) {
  test.describe(`at ${vp.name} size`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('the sign-in is refused without consent; the modal shows, reads a legal page, keeps Reject out, lets Accept in', async ({
      page,
    }) => {
      const refused = await page.request.post('/api/auth/exchange', { data: { token: 'whatever' } });
      expect(refused.status()).toBe(403);
      expect(await refused.json()).toEqual({ code: 'consent_required' });

      await page.goto('/login');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'Cookies & Data Processing' })).toBeVisible();
      await fitsViewport(page, '[data-testid="consent-modal"]');
      await expect(dialog.getByRole('button', { name: 'Accept' })).toBeInViewport();
      await expect(dialog.getByRole('button', { name: 'Reject' })).toBeInViewport();

      await dialog.getByRole('button', { name: 'Impressum' }).click();
      await expect(dialog.getByText('Stadt Musterstadt')).toBeVisible();
      await dialog.getByRole('button', { name: 'Back' }).click();
      await expect(dialog.getByRole('heading', { name: 'Cookies & Data Processing' })).toBeVisible();

      await dialog.getByRole('button', { name: 'Reject' }).click();
      await expect(dialog).toBeVisible();
      expect((await page.request.post('/api/auth/exchange', { data: { token: 'x' } })).status()).toBe(403);

      await dialog.getByRole('button', { name: 'Accept' }).click();
      await expect(dialog).toBeHidden();
      await fitsViewport(page);
      await page.getByLabel('Access token').fill(issueToken());
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL(IN_APP);
    });

    test('a login link waits behind the modal, then signs in after Accept', async ({ page }) => {
      await page.goto(`/login?token=${issueToken()}`);
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(page.url()).not.toContain('token');
      await page.getByRole('button', { name: 'Accept' }).click();
      await expect(page).toHaveURL(IN_APP);
    });

    test('/legal lists the pages and /legal/<slug> shows one, without a session', async ({ page }) => {
      await page.goto('/legal');
      await expect(page.getByRole('heading', { level: 1, name: 'Legal Notices' })).toBeVisible();
      await fitsViewport(page);
      await page.getByRole('link', { name: 'Datenschutz' }).click();
      await expect(page).toHaveURL(/\/legal\/datenschutz$/);
      await expect(page.getByText('Wir speichern nichts.')).toBeVisible();
      await fitsViewport(page);
      expect((await page.request.get('/legal/gibt-es-nicht')).status()).toBe(404);
    });
  });
}

test.describe('German browser', () => {
  test.use({ locale: 'de-DE' });

  test('the modal and /legal speak German with no English left (v3 bug B2)', async ({ page }) => {
    await page.goto('/login');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Cookies & Datenverarbeitung' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Akzeptieren' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Ablehnen' })).toBeVisible();
    await page.goto('/legal');
    await expect(page.getByRole('heading', { level: 1, name: 'Rechtliche Hinweise' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Zurück' })).toBeVisible();
  });
});
