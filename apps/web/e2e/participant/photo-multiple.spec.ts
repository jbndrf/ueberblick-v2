import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { devices, expect, test } from '@playwright/test';
import { base32Decode, openProjectDb, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../playwright.config';
import { rosterToken } from '../seed';
import { goldenFile } from '../golden';
import { allowErrors, watchErrors } from './world';

/**
 * WP-789: "Foto auswählen" takes several photos at once (v3 MediaGallery.svelte:333, `multiple`). Two files in one pick
 * give two thumbnails, and the submitted run holds both refs. Phone and desktop.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const KEY = 'photomulti';
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
const png = (grey: number): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr.set([8, 0, 0, 0, 0], 8); // 8 bit grey
  const rows = Buffer.concat(
    Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(8, grey)])),
  );
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};
const PNG = png(128);
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });

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

const runs = (): { task: string }[] => {
  const db = openProjectDb(E2E_DATA_DIR, KEY);
  try {
    return db.prepare<{ task: string }>("SELECT task FROM runs WHERE task = 'melden'").all();
  } finally {
    db.close();
  }
};

const PNG2 = png(40); // a different picture, so the two photos get different hashes

for (const [name, screen] of [
  ['phone', {}],
  ['desktop', { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }],
] as const) {
  test.describe(name, () => {
    test.use(screen);
    test('two photos picked at once give two thumbnails and a run with both refs', async ({ page }) => {
      const problems = watchErrors(page);
      allowErrors(problems, /status of 404.*\/api\/p\/[^/]+\/blobs\//);
      const token = rosterToken(E2E_DATA_DIR, KEY, `p-multi-${name}`, ['melder']);
      expect((await page.request.post('/api/auth/exchange', { data: { token } })).status()).toBe(200);
      await page.goto('/map');
      await page.getByRole('button', { name: 'Neu' }).first().click();
      await page.getByTestId('create-pill').first().click();
      await page.getByTestId('placement-confirm').click();
      await page.getByLabel('Kategorie').click();
      await page.getByText('Beleuchtung', { exact: true }).click();
      await page.getByLabel('Beschreibung').fill('Zwei Fotos');
      const choose = page.locator('input[type=file]:not([capture])').last();
      await expect(choose).toHaveAttribute('multiple', '');
      await expect(page.locator('input[type=file][capture]').last()).not.toHaveAttribute('multiple', '');
      await choose.setInputFiles([
        { name: 'eins.png', mimeType: 'image/png', buffer: PNG },
        { name: 'zwei.png', mimeType: 'image/png', buffer: PNG2 },
      ]);
      await expect(page.getByRole('status').filter({ hasText: 'Foto hinzugefügt' })).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => [...document.images].filter((i) => i.src.startsWith('blob:') && i.naturalWidth > 0).length,
          ),
        )
        .toBe(2);
      const before = runs().length;
      await page.getByRole('button', { name: 'Absenden' }).click();
      await expect.poll(() => runs().length, { timeout: 20_000 }).toBe(before + 1);
      const db = openProjectDb(E2E_DATA_DIR, KEY);
      try {
        const row = db
          .prepare<{ input: string }>(
            "SELECT input FROM runs WHERE task = 'melden' ORDER BY seq DESC LIMIT 1",
          )
          .get();
        const foto = (JSON.parse(row?.input ?? '{}') as { foto?: { sha256: string }[] }).foto ?? [];
        expect(foto).toHaveLength(2);
      } finally {
        db.close();
      }
      expect(problems).toEqual([]);
    });
  });
}
