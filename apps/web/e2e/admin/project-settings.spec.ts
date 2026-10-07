import { expect, test, type Page } from '@playwright/test';
import { goldenData, goldenFile } from '../golden';
import { admin, createAdmin, signInAs } from './sign-in';
import { publish } from '../support/publish';

/**
 * WP-375: Projekteinstellungen (v3 `settings/+page.svelte`) against the real built process, at phone (390x844) and
 * desktop (1280x800) size: the section sidebar and `?section=`, Branding (App-Name, Symbol hochladen) and the
 * Standardansicht (zoom, min/max zoom, centre) saved into the draft, published from the bar, and then read as a
 * participant: the bootstrap's display name and icon, and the icon's bytes.
 */
const TEMPLATE = goldenFile('templates/maengelmelder/1.0.0.yaml');
const KEY = 'einstellungsstadt';
const PAGE = `/admin/projects/${KEY}/settings`;
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;
/** A 1x1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.use({ locale: 'de-DE' });
test.describe.configure({ mode: 'serial' });

let admins = 0;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', KEY, 'Einstellungen Stadt']).status).toBe(0);
  createAdmin('einstellungen-deploy@example.org');
  expect(admin(['add-membership', 'einstellungen-deploy@example.org', KEY, 'sachbearbeiter']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'einstellungen-deploy@example.org', password: 'correct horse battery' },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: goldenData('projects/stadtwerke-meldungen.yaml'),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

async function signIn(page: Page): Promise<void> {
  const email = `einstellungen${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, KEY, 'sachbearbeiter']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

/** A participant of the project, signed in through its QR token in a context of its own. */
async function participant(
  playwright: Parameters<Parameters<typeof test>[2]>[0]['playwright'],
  baseURL: string,
) {
  const added = admin(['participant', 'add', KEY, `Anna ${Date.now()}`, 'melder']);
  expect(added.status).toBe(0);
  const id = /with id (\S+?)\.?$/m.exec(added.out)?.[1] ?? '';
  const qr = admin(['participant', 'qr', KEY, id]);
  expect(qr.status).toBe(0);
  const token = qr.out.trim().split('\n').at(-1) ?? '';
  const ctx = await playwright.request.newContext({ baseURL });
  expect((await ctx.post('/api/auth/exchange', { data: { token } })).status()).toBe(200);
  return ctx;
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("the sidebar shows each section's status dot (Lebenszyklus off once published, Chat as the project says)", async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(PAGE);
      const nav = page.getByRole('navigation', { name: 'Einstellungsbereiche' });
      // a section with a status carries a dot: published project -> the Projekt & Freigabe dot is "off"; Chat has one as well
      await expect(nav.locator('[data-section="project"] [data-status]')).toHaveAttribute(
        'data-status',
        'off',
      );
      await expect(nav.locator('[data-section="chat"] [data-status]')).toHaveAttribute(
        'data-status',
        /^(on|off)$/,
      );
      // a section without a status has no dot
      await expect(nav.locator('[data-section="startup"] [data-status]')).toHaveCount(0);
    });

    test('journey: edit Branding and the Standardansicht, publish, read it as a participant', async ({
      page,
      playwright,
      baseURL,
    }) => {
      await signIn(page);
      await page.goto(PAGE);

      // The shell: v3's heading and sidebar groups; no placeholder for this entry any more.
      await expect(page.getByRole('heading', { level: 1, name: 'Projekteinstellungen' })).toBeVisible();
      const nav = page.getByRole('navigation', { name: 'Einstellungsbereiche' });
      await expect(nav).toContainText('Allgemein');
      await expect(nav).toContainText('Karte');
      await expect(page.getByText('noch nicht portiert')).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 2, name: 'App-Branding' })).toBeVisible();
      const sidebarBox = await nav.boundingBox();
      const sectionBox = await page.getByTestId('settings-section').boundingBox();
      if (size.name === 'phone')
        expect(sectionBox?.y ?? 0).toBeGreaterThan(sidebarBox?.y ?? 0); // below it
      else expect(sectionBox?.x ?? 0).toBeGreaterThan(sidebarBox?.x ?? 0); // beside it

      // Branding: the App-Name and the icon go into the draft; the publish bar shows it.
      const displayName = `Stadtwerke App ${size.name}`;
      await page.getByLabel('App-Name').fill(displayName);
      await page.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('App-Name gespeichert')).toBeVisible();
      await expect(page.getByTestId('publish-bar')).toBeVisible();
      await page.getByLabel('Bilddatei für das Symbol').setInputFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: PNG,
      });
      await expect(page.getByAltText('Symbolvorschau')).toBeVisible();
      await page.getByRole('button', { name: 'Symbol hochladen' }).click();
      await expect(page.getByText('Symbol hochgeladen')).toBeVisible();
      await expect(page.getByAltText('Projektsymbol')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Symbol entfernen' })).toBeVisible();

      // A text file is refused by the upload with a message, and nothing changes.
      await page.getByLabel('Bilddatei für das Symbol').setInputFiles({
        name: 'notiz.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hallo'),
      });
      await page.getByRole('button', { name: 'Symbol hochladen' }).click();
      await expect(page.getByText('Bitte ein PNG-, JPG-, SVG- oder WebP-Bild wählen')).toBeVisible();

      // Standardansicht: the section is in the URL and survives a reload.
      await nav.getByRole('button', { name: 'Standardansicht' }).click();
      await expect(page).toHaveURL(/[?&]section=map-defaults/);
      await page.reload();
      await expect(page.getByRole('heading', { level: 2, name: 'Standard-Kartenansicht' })).toBeVisible();
      await page.getByLabel('Standard-Zoom').fill('0');
      await page.getByRole('button', { name: 'Standards speichern' }).click();
      await expect(page.getByText('Standard-Zoom liegt unter Min. Zoom')).toBeVisible();
      await page.getByLabel('Standard-Zoom').fill('12');
      await page.getByLabel('Min. Zoom').fill('4');
      await page.getByLabel('Max. Zoom').fill('17');
      await page.getByLabel('Zentrum Breitengrad').fill('50.7');
      await page.getByLabel('Zentrum Längengrad').fill('7.1');
      await page.getByRole('button', { name: 'Standards speichern' }).click();
      await expect(page.getByText('Kartenstandards gespeichert')).toBeVisible();
      await expect(page.getByTestId('map-summary')).toContainText('50.7000, 7.1000');

      // Back to Branding: the saved values are shown from the draft.
      await page.goto(PAGE);
      await expect(page.getByLabel('App-Name')).toHaveValue(displayName);
      await publish(page, { via: 'bar' });

      // As a participant: the bootstrap carries the new name and the icon, and the icon's bytes download.
      const ctx = await participant(playwright, baseURL ?? '');
      const bootstrap = await (await ctx.get('/participant-api/bootstrap')).json();
      expect(bootstrap.project.displayName).toBe(displayName);
      const icon: string = bootstrap.project.icon;
      expect(icon).toMatch(/^[0-9a-f]{64}$/);
      const blob = await ctx.get(`/api/p/${KEY}/blobs/${icon}`);
      expect(blob.status()).toBe(200);
      expect(blob.headers()['content-type']).toBe('image/png');
      expect(Buffer.from(await blob.body()).equals(PNG)).toBe(true);
      await ctx.dispose();

      // Symbol entfernen: the icon leaves the draft; the published one stays until the next publish.
      await expect(page.getByRole('button', { name: 'Symbol entfernen' })).toBeVisible();
      await page.getByRole('button', { name: 'Symbol entfernen' }).click();
      await expect(page.getByText('Symbol entfernt')).toBeVisible();
      await expect(page.getByTestId('icon-placeholder')).toBeVisible();
      await expect(page.getByTestId('publish-bar')).toBeVisible();
      await publish(page, { via: 'bar' });
      const after = await participant(playwright, baseURL ?? '');
      expect((await (await after.get('/participant-api/bootstrap')).json()).project.icon).toBeNull();
      await after.dispose();
    });
  });
}

test('the upload endpoint: 401 without a session, 403 for a participant, typed refusals for a text file and a big file', async ({
  playwright,
  baseURL,
  page,
}) => {
  const anon = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const noCookie = await anon.post(`/api/admin/p/${KEY}/assets`, {
    data: PNG,
    headers: { 'content-type': 'image/png', 'sec-fetch-site': 'same-origin' },
  });
  expect(noCookie.status()).toBe(401);
  await anon.dispose();

  const guest = await participant(playwright, baseURL ?? '');
  const forbidden = await guest.post(`/api/admin/p/${KEY}/assets`, {
    data: PNG,
    headers: { 'content-type': 'image/png' },
  });
  expect([401, 403]).toContain(forbidden.status());
  await guest.dispose();

  await signIn(page);
  await page.goto(PAGE);
  const post = (body: number[], type: string) =>
    page.evaluate(
      async ({ body, type, key }) => {
        const r = await fetch(`/api/admin/p/${key}/assets`, {
          method: 'POST',
          headers: { 'content-type': type },
          body: new Uint8Array(body),
        });
        return { status: r.status, body: (await r.json()) as { error?: { code?: string } } };
      },
      { body, type, key: KEY },
    );
  const text = await post([104, 105], 'text/plain');
  expect(text).toMatchObject({ status: 400, body: { error: { code: 'invalid_body' } } });
  const big = await page.evaluate(async (key) => {
    const bytes = new Uint8Array(2 * 1024 * 1024 + 1);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const r = await fetch(`/api/admin/p/${key}/assets`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: bytes,
    });
    return { status: r.status, body: (await r.json()) as { error?: { code?: string } } };
  }, KEY);
  expect(big).toMatchObject({ status: 413, body: { error: { code: 'payload_too_large' } } });
});
