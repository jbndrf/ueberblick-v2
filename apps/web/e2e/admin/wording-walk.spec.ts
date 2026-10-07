import { expect, test, type Page } from '@playwright/test';
import { goldenData, goldenFile } from '../golden';
import { admin, createAdmin, PASSWORD, signInAs } from './sign-in';

/**
 * WP-519: the wording walk. Every admin page and the builder of one project, in German: no raw message key, no
 * English UI word and no engine word an admin would not know. (The Code view and the Problems pane quote the project
 * file on purpose; only their surrounding text counts.)
 */
const EMAIL = 'wording-walk@example.org';
const RAW_KEY = /\b(admin|builder|participant)_[a-z0-9]+(_[a-z0-9]+)+\b/;
const ENGLISH =
  /\b(Loading|Cancel|Delete|Save changes|Settings|Publish|Draft|Please|Something went wrong|No results)\b/;
const JARGON = /\b(Prozess|Template-Lock|Observation|Observations|Bind)\b/;

/** WP-559: the same walk for the other golden templates (templates published in order; the project extends the last). */
const PROJECTS = [
  {
    key: 'wordingstadt',
    templates: ['templates/maengelmelder/1.0.0.yaml'],
    project: 'projects/stadtwerke-meldungen.yaml',
    type: 'meldung',
    role: 'sachbearbeiter',
  },
  {
    key: 'wordingbaeume',
    templates: ['templates/baumkataster/1.0.0.yaml', 'templates/baumkataster/1.1.0.yaml'],
    project: 'projects/musterstadt-baeume.yaml',
    type: 'baum',
    role: 'verwaltung',
  },
  {
    key: 'wordingfeste',
    templates: ['templates/veranstaltung/1.0.0.yaml'],
    project: 'projects/ordnungsamt-veranstaltungen.yaml',
    type: 'veranstaltung',
    role: 'sachbearbeiter',
  },
] as const;

test.use({ locale: 'de-DE' });

test.beforeAll(async ({ playwright, baseURL }) => {
  createAdmin(EMAIL);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  for (const p of PROJECTS) {
    expect(admin(['create-project', p.key, `Wording ${p.key}`]).status).toBe(0);
    expect(admin(['add-membership', EMAIL, p.key, p.role]).status).toBe(0);
    for (const t of p.templates) expect(admin(['publish-template', goldenFile(t)]).status).toBe(0);
  }
  expect((await ctx.post('/api/auth/login', { data: { email: EMAIL, password: PASSWORD } })).status()).toBe(
    200,
  );
  for (const p of PROJECTS) {
    const deploy = await ctx.post(`/api/admin/p/${p.key}/deploy`, { data: goldenData(p.project) });
    expect(await deploy.json()).toMatchObject({ ok: true });
  }
  await ctx.dispose();
});

async function scan(page: Page, where: string): Promise<void> {
  const text = await page.locator('body').innerText();
  expect(text.match(RAW_KEY)?.[0], `raw key on ${where}`).toBeUndefined();
  expect(text.match(ENGLISH)?.[0], `English word on ${where}`).toBeUndefined();
  expect(text.match(JARGON)?.[0], `engine word on ${where}`).toBeUndefined();
}

function pagesOf(key: string, type: string): string[] {
  const base = `/admin/projects/${key}`;
  return [
    '/admin/projects',
    '/admin/instance',
    `${base}/roles`,
    `${base}/participants`,
    `${base}/tables`,
    `${base}/relations`,
    `${base}/versions`,
    `${base}/types/${type}`,
    `${base}/settings`,
    ...['template', 'layers', 'lifecycle', 'chat', 'info-pages', 'offline-packs', 'api-tokens'].map(
      (s) => `${base}/settings?section=${s}`,
    ),
  ];
}

for (const size of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
]) {
  test.describe(`${size.name} (${size.width}x${size.height})`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const p of PROJECTS) {
      test(`${p.key}: every admin page reads as German without keys or jargon`, async ({ page }) => {
        await signInAs(page, EMAIL);
        await expect(page).toHaveURL(/\/admin\/projects/);
        for (const path of pagesOf(p.key, p.type)) {
          await page.goto(path);
          await page.waitForLoadState('networkidle');
          expect(page.url(), 'signed in').toContain(path.split('?')[0]);
          await scan(page, path);
        }
      });

      test(`${p.key}: the builder reads as German`, async ({ page }) => {
        test.skip(size.name === 'phone', 'the builder is a desktop tool');
        await signInAs(page, EMAIL);
        await expect(page).toHaveURL(/\/admin\/projects/);
        await page.goto(`/admin/projects/${p.key}/types/${p.type}/builder`);
        await expect(page.getByTestId('builder-frame')).toBeVisible();
        await scan(page, `${p.key} builder`);
        // C-004: the catalog's one list of actions, read in admin words
        const catalog = page.getByTestId('builder-catalog');
        await expect(catalog.getByTestId('catalog-actions')).toBeVisible();
        await scan(page, `${p.key} builder catalog`);
      });
    }
  });
}
