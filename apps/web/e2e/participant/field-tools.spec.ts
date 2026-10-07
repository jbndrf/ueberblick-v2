import { deflateSync } from 'node:zlib';
import { devices, expect, test as base, type Locator, type Page } from '@playwright/test';
import { E2E_PORT } from '../../playwright.config';
import {
  acceptedRuns,
  blobShas,
  FILES_MAX,
  lastValue,
  mapZoom,
  sameShape,
  seedFieldWorld,
  signInField,
} from './field-world';
import { allowErrors, watchErrors } from './world';

/**
 * WP-753: the step-2 field tools on the built app with the real MapLibre canvas, at Pixel 7 and at Desktop Chrome
 * 1280x800, de-DE. Drawing is done with pixel taps. v3 sources: geometry-draw-tool.svelte:317-334 (undo, redo),
 * :495-548 (Fertig), MediaGallery.svelte:111,316-331 (the picker, the maximum). Each journey fails on a console error.
 */
const { defaultBrowserType: _pixel, ...pixel } = devices['Pixel 7'];
const { defaultBrowserType: _desktop, ...desktop } = devices['Desktop Chrome'];
void _pixel;
void _desktop;
const SIZES = [
  { name: 'Pixel 7', use: pixel },
  { name: 'Desktop 1280x800', use: { ...desktop, viewport: { width: 1280, height: 800 } } },
] as const;

// a spec-local world per worker (not a shared beforeAll): a restarted worker finds the project there
const test = base.extend<object, { world: undefined }>({
  world: [
    async ({ playwright }, use) => {
      await seedFieldWorld(playwright, `http://localhost:${E2E_PORT}`);
      await use(undefined);
    },
    { scope: 'worker', auto: true },
  ],
});

// a 16x16 PNG whose colour comes from `seed` (the photo tool turns any image into a JPEG); the tests share its bytes
const crc = (buf: Buffer): number => {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
};
const chunk = (type: string, data: Buffer): Buffer => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(body));
  return Buffer.concat([head, body, tail]);
};
const PHOTO_SEED = 42;
function png(seed: number): Buffer {
  const size = 16;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // RGB
  const row = Buffer.concat([
    Buffer.from([0]),
    ...Array.from({ length: size }, () => Buffer.from([seed % 256, (seed * 7) % 256, (seed * 13) % 256])),
  ]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const pdf = (name: string): { name: string; mimeType: string; buffer: Buffer } => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from(`%PDF-1.4 ${name} ${Date.now()}`),
});

type Tap = readonly [number, number];
const BLOB_404 = /status of 404.*\/api\/p\/[^/]+\/blobs\//;

let problems: string[] = [];
test.beforeEach(({ page }) => {
  problems = watchErrors(page);
  allowErrors(problems, BLOB_404); // the queue's honest HEAD of a photo that is not on the server yet
});
test.afterEach(() => {
  expect(problems).toEqual([]);
});

/** A participant of this test only (the preferences follow the person). */
const who = (
  info: { project: { name: string }; repeatEachIndex: number; retry: number },
  tag: string,
): string => `p-${tag}-${info.repeatEachIndex}-${info.retry}`;

async function startTask(page: Page, task: string): Promise<void> {
  await page.getByRole('button', { name: 'Neu' }).first().click();
  await page.locator(`[data-testid=create-pill][data-task=${task}]`).click();
}

/** Page positions for the vertices of a shape, as offsets from a point in the lower left of the map (clear of the toolbar). */
async function anchor(page: Page): Promise<Tap> {
  const box = await page.getByTestId('map').boundingBox();
  if (box === null) throw new Error('no map box');
  return [box.x + box.width * 0.3, box.y + box.height * 0.6];
}
const at = (origin: Tap, [dx, dy]: Tap): Tap => [origin[0] + dx, origin[1] + dy];

async function tapAll(page: Page, taps: readonly Tap[]): Promise<void> {
  const vertices = page.locator('.ub-draw-vertex');
  const before = await vertices.count();
  for (const [i, [x, y]] of taps.entries()) {
    await page.mouse.click(x, y);
    await expect(vertices).toHaveCount(before + i + 1);
  }
}

async function drag(page: Page, vertex: Locator, by: Tap): Promise<void> {
  const box = await vertex.boundingBox();
  if (box === null) throw new Error('no vertex');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + by[0], y + by[1], { steps: 8 });
  await page.mouse.up();
}

const position = (g: unknown): number[][] => {
  const c = (g as { coordinates: unknown }).coordinates;
  return (Array.isArray(c) && Array.isArray(c[0]) && Array.isArray(c[0][0]) ? c[0] : c) as number[][];
};

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ ...size.use, locale: 'de-DE' });

    test('area: four vertices, Rückgängig, Wiederherstellen, drag a non-first vertex, Fertig; the server has the edited ring', async ({
      page,
    }, info) => {
      await signInField(page, who(info, 'area'));
      const before = acceptedRuns('flaeche_anlegen');
      await startTask(page, 'flaeche_anlegen');
      await expect(page.getByTestId('draw-toolbar')).toBeVisible();
      const zoom = await mapZoom(page);
      const o = await anchor(page);
      const [a, b, c, d] = [at(o, [-60, 40]), at(o, [60, 40]), at(o, [60, -60]), at(o, [-60, -60])] as const;
      const vertices = page.locator('.ub-draw-vertex');
      await tapAll(page, [a, b, c, d]);
      // Rückgängig takes the fourth vertex away, Wiederherstellen brings it back (v3 undo/redo :317-334)
      await page.getByTestId('draw-undo').click();
      await expect(vertices).toHaveCount(3);
      await page.getByTestId('draw-redo').click();
      await expect(vertices).toHaveCount(4);
      // the third vertex is dragged north-east; the first stays
      const moved: Tap = [c[0] + 24, c[1] - 30];
      await drag(page, vertices.nth(2), [24, -30]);
      await page.getByTestId('draw-finish').click();
      await page.getByLabel('Name').fill('Wiese');
      await page.getByRole('button', { name: 'Absenden' }).click();
      await expect.poll(() => acceptedRuns('flaeche_anlegen'), { timeout: 20_000 }).toBe(before + 1);
      const stored = lastValue('flaeche_anlegen', 'geometrie');
      if (stored?.geometry === undefined) throw new Error('the run wrote no geometry');
      expect(stored.geometry.type).toBe('Polygon');
      const ring = position(stored.geometry);
      expect(ring[ring.length - 1]).toEqual(ring[0]); // closed
      expect(sameShape(ring.slice(0, -1), [a, b, moved, d], zoom)).toBe(true);
      // the dragged vertex really moved: the unedited square is not what is stored
      expect(sameShape(ring.slice(0, -1), [a, b, c, d], zoom)).toBe(false);
    });

    test('line: drawn with three taps, sent, and stored on the server as a LineString', async ({
      page,
    }, info) => {
      await signInField(page, who(info, 'line'));
      const before = acceptedRuns('weg_anlegen');
      await startTask(page, 'weg_anlegen');
      const zoom = await mapZoom(page);
      const o = await anchor(page);
      const taps = [at(o, [-70, 50]), at(o, [0, -20]), at(o, [70, 40])] as const;
      await tapAll(page, taps);
      await page.getByTestId('draw-finish').click();
      await page.getByLabel('Name').fill('Pfad');
      await page.getByRole('button', { name: 'Absenden' }).click();
      await expect.poll(() => acceptedRuns('weg_anlegen'), { timeout: 20_000 }).toBe(before + 1);
      const stored = lastValue('weg_anlegen', 'geometrie');
      if (stored?.geometry === undefined) throw new Error('the run wrote no geometry');
      expect(stored.geometry.type).toBe('LineString');
      expect(sameShape(position(stored.geometry), taps, zoom)).toBe(true);
    });

    test('a self-intersecting area is refused with its reason, nothing is sent, and the drawing stays', async ({
      page,
    }, info) => {
      await signInField(page, who(info, 'bow'));
      const before = acceptedRuns('flaeche_anlegen');
      await startTask(page, 'flaeche_anlegen');
      const o = await anchor(page);
      // a bow-tie: the edges A-B and C-D cross
      await tapAll(page, [at(o, [-60, 40]), at(o, [60, -60]), at(o, [60, 40]), at(o, [-60, -60])]);
      await page.getByTestId('draw-finish').click();
      await expect(page.getByTestId('draw-refused')).toBeVisible();
      await expect(page.getByTestId('draw-refused')).toHaveText(
        'Nicht übernommen: die Form überschneidet sich selbst.',
      );
      await expect(page.getByTestId('draw-toolbar')).toBeVisible();
      await expect(page.locator('.ub-draw-vertex')).toHaveCount(4);
      expect(acceptedRuns('flaeche_anlegen')).toBe(before);
      // the refusal does not cost the drawing: without the fourth vertex the triangle is accepted
      await page.getByTestId('draw-undo').click();
      await page.getByTestId('draw-finish').click();
      await expect(page.getByLabel('Name')).toBeVisible();
      await expect(page.getByTestId('draw-refused')).toHaveCount(0);
    });

    test('files: a wrong type is refused, two PDFs are attached, the maximum holds, and the server stores them', async ({
      page,
    }, info) => {
      await signInField(page, who(info, 'files'));
      const before = acceptedRuns('dokument_anlegen');
      const shasBefore = new Set(blobShas());
      await startTask(page, 'dokument_anlegen');
      await page.getByTestId('placement-confirm').click();
      await page.getByLabel('Name').fill('Akte');
      const input = page.locator('input[type=file][accept="application/pdf"]');
      const status = page.getByRole('status').filter({ hasText: /Dateityp|Hinzugefügt|Dateilimit/ });
      const removers = page.getByRole('button', { name: /entfernen$/ });
      // a wrong type: a message, no file
      await input.setInputFiles({ name: 'notiz.txt', mimeType: 'text/plain', buffer: Buffer.from('hallo') });
      await expect(status).toBeVisible();
      await expect(status).toHaveText('Dieser Dateityp ist hier nicht erlaubt.');
      await expect(removers).toHaveCount(0);
      // two files at once
      await input.setInputFiles([pdf('plan-a.pdf'), pdf('plan-b.pdf')]);
      await expect(removers).toHaveCount(FILES_MAX);
      await expect(page.getByText('plan-a.pdf')).toBeVisible();
      await expect(page.getByText('plan-b.pdf')).toBeVisible();
      await expect(status).toBeVisible();
      await expect(status).toContainText('Dateilimit erreicht');
      // the maximum: a third file is not added
      await input.setInputFiles(pdf('plan-c.pdf'));
      await expect(removers).toHaveCount(FILES_MAX);
      await expect(page.getByText('plan-c.pdf')).toHaveCount(0);
      await page.getByRole('button', { name: 'Absenden' }).click();
      await expect.poll(() => acceptedRuns('dokument_anlegen'), { timeout: 20_000 }).toBe(before + 1);
      const stored = lastValue('dokument_anlegen', 'unterlagen');
      const files = (stored?.value ?? []) as { sha256: string; name: string; mime: string }[];
      expect(files.map((f) => f.name)).toEqual(['plan-a.pdf', 'plan-b.pdf']);
      await expect
        .poll(() => files.every((f) => blobShas().includes(f.sha256) && !shasBefore.has(f.sha256)))
        .toBe(true);
    });

    test('photo: a second participant attaches the identical bytes; the device PUTs once, the server keeps one blob and accepts', async ({
      page,
      browser,
    }, info) => {
      const attach = async (p: Page, name: string): Promise<void> => {
        await startTask(p, 'foto_melden');
        await p.getByTestId('placement-confirm').click();
        await p.getByLabel('Name').fill(name);
        await p
          .locator('input[type=file]')
          .last()
          .setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: png(PHOTO_SEED) });
        await expect(p.getByRole('status').filter({ hasText: 'Foto hinzugefügt' })).toBeVisible();
        await p.getByRole('button', { name: 'Absenden' }).click();
      };
      const before = acceptedRuns('foto_melden');
      // A attaches the photo to their feature
      await signInField(page, who(info, 'same-a'));
      await attach(page, 'Lampe A');
      await expect.poll(() => acceptedRuns('foto_melden'), { timeout: 20_000 }).toBe(before + 1);
      const a = lastValue('foto_melden', 'foto');
      const aFile = (a?.value as { sha256: string }[] | undefined)?.[0];
      if (aFile === undefined) throw new Error('the server holds no photo of A');
      expect(blobShas()).toContain(aFile.sha256);
      const blobsAfterA = blobShas().length;
      // B, a second device, attaches the identical bytes to their own feature
      const ctx = await browser.newContext({
        ...size.use,
        locale: 'de-DE',
        baseURL: `http://localhost:${E2E_PORT}`,
      });
      try {
        const other = await ctx.newPage();
        const otherProblems = watchErrors(other);
        allowErrors(otherProblems, BLOB_404);
        const puts: string[] = [];
        const heads: number[] = [];
        other.on('request', (r) => {
          if (r.method() === 'PUT' && /\/api\/p\/[^/]+\/blobs\//.test(r.url())) puts.push(r.url());
        });
        other.on('response', (r) => {
          const q = r.request();
          if (q.method() === 'HEAD' && /\/api\/p\/[^/]+\/blobs\//.test(r.url())) heads.push(r.status());
        });
        await signInField(other, who(info, 'same-b'));
        await attach(other, 'Lampe B');
        await expect.poll(() => acceptedRuns('foto_melden'), { timeout: 20_000 }).toBe(before + 2);
        const b = lastValue('foto_melden', 'foto');
        const bFile = (b?.value as { sha256: string }[] | undefined)?.[0];
        expect(b?.featureId).not.toBe(a?.featureId);
        expect(bFile?.sha256).toBe(aFile.sha256);
        // WP-785: no HEAD probe; the device holds the bytes, so it PUTs, and the server dedupes by sha256
        expect(heads).toEqual([]);
        expect(puts).toHaveLength(1);
        expect(blobShas().length).toBe(blobsAfterA);
        expect(otherProblems).toEqual([]);
      } finally {
        await ctx.close();
      }
    });

    test('photo: a sent photo shows in the Daten carousel and opens the lightbox', async ({ page }, info) => {
      await signInField(page, who(info, 'photo'));
      const before = acceptedRuns('foto_melden');
      await startTask(page, 'foto_melden');
      await page.getByTestId('placement-confirm').click();
      await page.getByLabel('Name').fill('Lampe');
      await page
        .locator('input[type=file]')
        .last()
        .setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: png(PHOTO_SEED) });
      await expect(page.getByRole('status').filter({ hasText: 'Foto hinzugefügt' })).toBeVisible();
      await page.getByRole('button', { name: 'Absenden' }).click();
      await expect.poll(() => acceptedRuns('foto_melden'), { timeout: 20_000 }).toBe(before + 1);
      const sent = lastValue('foto_melden', 'foto')?.value as { name: string }[] | undefined;
      const name = sent?.[0]?.name;
      if (name === undefined) throw new Error('the server holds no photo');
      // after Absenden the new object's sheet is open
      await page.getByRole('tab', { name: 'Daten' }).click();
      const gallery = page.getByTestId('gallery');
      await expect(gallery).toBeVisible();
      const thumb = gallery.locator('img').first();
      await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
      await gallery.getByRole('button', { name: `${name} öffnen` }).click();
      const lightbox = page.getByRole('dialog', { name });
      await expect(lightbox).toBeVisible();
      const big = lightbox.locator('img');
      await expect.poll(() => big.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
      await page.keyboard.press('Escape');
      await expect(lightbox).toBeHidden();
    });
  });
}
