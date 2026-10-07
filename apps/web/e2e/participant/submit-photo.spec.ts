import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { devices, expect, test, type Page } from '@playwright/test';
import { base32Decode, openProjectDb, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { rosterToken } from '../seed';
import { goldenFile } from '../golden';
import { watchErrors } from './world';

/**
 * WP-696 (owner bug): Absenden of a new Mangel on a phone, against the built process with its real security headers
 * (the CSP is sent only there). A reporter creates a defect with and without a photo; the run must be stored on the
 * device, reach the server through sync, and a photo must show as a thumbnail and be stored.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const KEY = 'submitstadt';
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;
// an 8x8 grey PNG, made here so that the spec needs no binary fixture (the photo tool turns any image into a JPEG)
const crc = (buf: Buffer): number => {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
};
const chunk = (type: string, data: Buffer): Buffer => {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(body));
  return Buffer.concat([head, body, tail]);
};
const PNG = ((): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr.set([8, 0, 0, 0, 0], 8); // 8 bit grey
  const rows = Buffer.concat(
    Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(8, 128)])),
  );
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
})();
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });
const SCREENS = [
  ['phone', {}],
  ['desktop', { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }],
] as const;

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

test.beforeAll(async ({ playwright, baseURL }) => {
  // a failed test restarts the worker and runs this again on the same server: an existing project is fine
  admin(['create-project', KEY, KEY]);
  // beforeAll runs again for each --repeat-each round on the same server: a fresh admin every time
  const email = `submit-${Date.now()}@example.org`;
  const created = admin(['create-admin', email]);
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', email, totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', email, KEY, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', goldenFile('templates/maengelmelder/1.0.0.yaml')]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email, password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${KEY}/deploy`, {
    data: { schema: 'ueberblick/1', extends: 'maengelmelder@1' },
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
});

const runs = (): { task: string; blobs: number }[] => {
  const db = openProjectDb(E2E_DATA_DIR, KEY);
  try {
    return db
      .prepare<{ task: string; n: number }>(
        "SELECT r.task AS task, (SELECT count(*) FROM blobs) AS n FROM runs r WHERE r.task = 'melden'",
      )
      .all()
      .map((r) => ({ task: r.task, blobs: r.n }));
  } finally {
    db.close();
  }
};

/** Every request for a blob, as `METHOD url`, of the page that `report` drives. */
const blobRequests: string[] = [];
/** Every response of status 400 or more, as `status METHOD url`: it names the request behind a console error line. */
const failedResponses: string[] = [];

async function report(page: Page, withPhoto: boolean, id: string): Promise<string[]> {
  const problems = watchErrors(page); // console errors, page errors and CSP violations
  blobRequests.length = 0;
  failedResponses.length = 0;
  page.on('response', (r) => {
    if (r.status() >= 400) failedResponses.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  page.on('request', (r) => {
    if (r.url().includes('/blobs/')) blobRequests.push(`${r.method()} ${r.url()}`);
  });
  const token = rosterToken(E2E_DATA_DIR, KEY, id, ['melder']);
  expect((await page.request.post('/api/auth/exchange', { data: { token } })).status()).toBe(200);
  await page.goto('/map');
  await page.getByRole('button', { name: 'Neu' }).first().click();
  await page.getByTestId('create-pill').first().click();
  await page.getByTestId('placement-confirm').click();
  await page.getByLabel('Kategorie').click();
  await page.getByText('Beleuchtung', { exact: true }).click();
  await page.getByLabel('Beschreibung').fill('Lampe defekt');
  if (withPhoto) {
    await page
      .locator('input[type=file]')
      .last()
      .setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('status').filter({ hasText: 'Foto hinzugefügt' })).toBeVisible();
    // the tile shows the picture (a blob: URL the CSP must allow), not the file name as alt text
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.images].some((i) => i.src.startsWith('blob:') && i.naturalWidth > 0),
        ),
      )
      .toBe(true);
  }
  await page.getByRole('button', { name: 'Absenden' }).click();
  return problems;
}

for (const [name, screen] of SCREENS) {
  test.describe(name, () => {
    test.use(screen);
    for (const withPhoto of [false, true]) {
      test(`Absenden stores and sends a new Mangel ${withPhoto ? 'with' : 'without'} a photo`, async ({
        page,
      }) => {
        const before = runs().length;
        const problems = await report(page, withPhoto, withPhoto ? 'p-photo' : 'p-plain');
        await expect(page.getByText('konnte nicht auf diesem Gerät gespeichert')).toBeHidden({
          timeout: 3000,
        });
        await expect.poll(() => runs().length, { timeout: 20_000 }).toBe(before + 1);
        if (withPhoto) {
          const db = openProjectDb(E2E_DATA_DIR, KEY);
          try {
            expect(db.prepare<{ n: number }>('SELECT count(*) AS n FROM blobs').get()?.n).toBeGreaterThan(0);
            // WP-708: the server makes the thumbnails Daten shows; both sizes answer an image, never a 404
            const sha =
              db.prepare<{ sha256: string }>('SELECT sha256 FROM blobs LIMIT 1').get()?.sha256 ?? '';
            for (const size of ['list', 'preview']) {
              const res = await page.request.get(`/api/p/${KEY}/blobs/${sha}?thumb=${size}`);
              expect(res.status(), `thumb=${size}`).toBe(200);
              expect(res.headers()['content-type']).toMatch(/^image\//);
            }
          } finally {
            db.close();
          }
        }
        if (withPhoto) {
          // WP-708: Daten shows the photo as a decoded thumbnail and the server's own ?thumb answers an image (the device itself shows its held bytes)
          // after Absenden the new Meldung's sheet is open
          await page.getByRole('tab', { name: 'Daten' }).click();
          const thumb = page.getByTestId('daten-property').locator('img').first();
          await expect(thumb).toBeVisible();
          await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
        }
        // WP-720: the page never asks the server for a photo it still holds (a GET of a blob, thumbnail or original).
        // WP-785: nor does the queue probe with HEAD (its 404 was a console error on every new photo); it only PUTs.
        expect(
          blobRequests.filter((r) => r.startsWith('GET ') || r.startsWith('HEAD ')),
          `blob requests that must not happen; failed responses: ${JSON.stringify(failedResponses)}`,
        ).toEqual([]);
        if (withPhoto) expect(blobRequests.some((r) => r.startsWith('PUT '))).toBe(true);
        // watchErrors lets through only map-resource 404s (by URL), so anything left is a real error
        expect(
          problems,
          `console, page and CSP problems; failed responses (a 5xx logs a console error): ${JSON.stringify(failedResponses)}`,
        ).toEqual([]);
      });
    }
  });
}
