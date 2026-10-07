import { expect, test, type Page } from '@playwright/test';
import { scan } from '../../../../../../../../../e2e/a11y/axe';

/** v3's Offline tab at phone 390x844 and desktop 1280x800 (the projects come from `phoneAndDesktop()`). */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Offline' })).toHaveAttribute('data-state', 'active');
});

const pack = (page: Page, call: string) => page.evaluate(`window.__pack.${call}`);

test('right sheet, w-80, the same at every width; no overlay darkens the map', async ({ page }) => {
  const sheet = page.locator('[data-slot="sheet-content"]');
  const width = page.viewportSize()?.width ?? 0;
  await expect.poll(async () => (await sheet.boundingBox())?.x).toBe(width - 320);
  expect((await sheet.boundingBox())?.width).toBe(320);
  await expect(page.locator('[data-slot="sheet-overlay"]')).toHaveCount(0);
});

test('the tab has the HardDrive icon and the cards stand in v3 order: install, Offline-Daten, Speicher', async ({
  page,
}) => {
  await expect(page.getByRole('tab', { name: 'Offline' }).locator('svg.lucide-hard-drive')).toBeVisible();
  const y = async (sel: string) => (await page.locator(sel).boundingBox())?.y ?? 0;
  const install = await y('[data-testid="pwa-card"]');
  const tiles = await y('[data-testid="tiles-card"]');
  const heading = await page.getByRole('heading', { name: 'Offline-Daten' }).boundingBox();
  await expect(page.getByTestId('storage-section')).toBeVisible();
  const storage = await y('[data-testid="storage-section"]');
  expect(install).toBeLessThan(heading?.y ?? 0);
  expect(heading?.y ?? 0).toBeLessThan(tiles);
  expect(tiles).toBeLessThan(storage);
  // the section heading is small, uppercase and wide-tracked as in v3
  const style = await page
    .getByRole('heading', { name: 'Offline-Daten' })
    .evaluate((e) => ({ t: getComputedStyle(e).textTransform, s: getComputedStyle(e).fontSize }));
  expect(style).toEqual({ t: 'uppercase', s: '12px' });
});

test('install card: the browser state, the disabled button, and the technical details on demand', async ({
  page,
}) => {
  await expect(page.getByText('Läuft im Browser')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Installieren' })).toBeDisabled();
  await expect(page.getByText('Technische Details')).toBeVisible();
  await expect(page.getByText('registriert')).toBeHidden();
  await page.getByText('Technische Details').click();
  await expect(page.getByText('registriert')).toBeVisible();
  await expect(page.getByText('nicht verfügbar')).toBeVisible();
  await pack(
    page,
    `fire('beforeinstallprompt', { preventDefault() {}, prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) })`,
  );
  await expect(page.getByRole('button', { name: 'Installieren' })).toBeEnabled();
  await expect(page.getByText('verfügbar', { exact: true })).toBeVisible();
});

test('no pack: the orange hint and the primary button open the selector, the dialog fits the viewport', async ({
  page,
}) => {
  await expect(page.getByText(/Noch keine Kartenkacheln heruntergeladen/)).toBeVisible();
  await page.getByRole('button', { name: 'Kacheln herunterladen' }).click();
  const dialog = page.getByTestId('package-dialog');
  await expect(dialog.getByText('Offline-Pakete')).toBeVisible();
  await expect(dialog.getByText('Zoom: 12–17')).toBeVisible();
  const box = await dialog.boundingBox();
  const view = page.viewportSize();
  expect(box?.width ?? 0).toBeLessThanOrEqual(512); // the kit's sm:max-w-lg wins over v3's max-w-md, as in v3
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(view?.width ?? 0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(view?.height ?? 0);
});

test('download: spinner and progress, the card above the bar at the v3 place, then the green pack box', async ({
  page,
}) => {
  await pack(page, 'hold()');
  await page.getByRole('button', { name: 'Kacheln herunterladen' }).click();
  await page.getByRole('button', { name: 'Herunterladen', exact: true }).click();
  await expect(
    page.getByTestId('package-dialog').getByText('Wird heruntergeladen', { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('package-dialog').locator('svg.animate-spin').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Paket wird heruntergeladen...' })).toBeDisabled();

  // the card above the bar: fixed right-4 bottom-20 left-4, and from md on right-4 with w-80
  const card = page.getByTestId('download-card');
  await expect(card).toBeVisible();
  const view = page.viewportSize();
  const box = await card.boundingBox();
  expect(Math.round((view?.height ?? 0) - ((box?.y ?? 0) + (box?.height ?? 0)))).toBe(80);
  expect(Math.round((view?.width ?? 0) - ((box?.x ?? 0) + (box?.width ?? 0)))).toBe(16);
  if ((view?.width ?? 0) < 768) expect(Math.round(box?.x ?? 0)).toBe(16);
  else expect(Math.round(box?.width ?? 0)).toBe(320);

  await pack(page, 'release()');
  await expect(
    page.getByTestId('package-dialog').getByText('Heruntergeladen', { exact: true }),
  ).toBeVisible();
  await expect(card).toBeHidden();
  await page.getByTestId('package-dialog').getByRole('button', { name: 'Schließen' }).click();
  const ready = page.getByTestId('ready-pack');
  await expect(ready).toContainText('Innenstadt');
  await expect(ready).toContainText('1.200 Kacheln');
  await expect(page.getByRole('button', { name: 'Bereich ändern' })).toBeVisible();
});

const packFile = async (page: Page, corrupt = false) =>
  Buffer.from((await page.evaluate(`window.__pack.file(${corrupt})`)) as number[]);

test('import: the hint and the button stand under the list; a pack file becomes a ready pack at once', async ({
  page,
}) => {
  const file = await packFile(page);
  await page.getByRole('button', { name: 'Kacheln herunterladen' }).click();
  const dialog = page.getByTestId('package-dialog');
  await expect(dialog.getByText('Haben Sie ein bereits heruntergeladenes Paket?')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Paket aus Datei importieren' })).toBeEnabled();
  await expect(dialog.getByTestId('import-input')).toHaveAttribute('accept', '.ubpack');
  await dialog
    .getByTestId('import-input')
    .setInputFiles({ name: 'Innenstadt.ubpack', mimeType: 'application/octet-stream', buffer: file });
  await expect(dialog.getByTestId('import-done')).toHaveText('1.200 Kacheln importiert');
  await expect(dialog.getByText('Heruntergeladen', { exact: true })).toBeVisible();
  await page.getByTestId('package-dialog').getByRole('button', { name: 'Schließen' }).click();
  await expect(page.getByTestId('ready-pack')).toContainText('1.200 Kacheln');
});

test('import: a wrong file and a corrupt pack are refused with a reason; nothing is stored', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Kacheln herunterladen' }).click();
  const dialog = page.getByTestId('package-dialog');
  const input = dialog.getByTestId('import-input');
  await input.setInputFiles({
    name: 'x.ubpack',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('no'),
  });
  await expect(dialog.getByTestId('import-failed')).toContainText(
    'Import fehlgeschlagen: Die Datei ist kein Offline-Paket.',
  );
  await input.setInputFiles({
    name: 'Innenstadt.ubpack',
    mimeType: 'application/octet-stream',
    buffer: await packFile(page, true),
  });
  await expect(dialog.getByTestId('import-failed')).toContainText(
    'Die Prüfsumme einer Kartenebene stimmt nicht',
  );
  await expect(dialog.getByText('Heruntergeladen', { exact: true })).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Herunterladen', exact: true })).toBeVisible();
});

test('a downloaded pack is also saved to Downloads as a .ubpack file, as in v3', async ({ page }) => {
  await page.getByRole('button', { name: 'Kacheln herunterladen' }).click();
  const saved = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Herunterladen', exact: true }).click();
  const download = await saved;
  expect(download.suggestedFilename()).toBe('Innenstadt.ubpack');
});

test('delete asks once more, then the tab is empty again', async ({ page }) => {
  await page.getByRole('button', { name: 'Kacheln herunterladen' }).click();
  await page.getByRole('button', { name: 'Herunterladen', exact: true }).click();
  await expect(
    page.getByTestId('package-dialog').getByText('Heruntergeladen', { exact: true }),
  ).toBeVisible();
  await page.getByTestId('package-dialog').getByRole('button', { name: 'Schließen' }).click();
  await page.getByRole('button', { name: 'Löschen', exact: true }).click();
  await page.getByRole('button', { name: 'Löschen bestätigen' }).click();
  await expect(page.getByText(/Noch keine Kartenkacheln heruntergeladen/)).toBeVisible();
});

test('the selector says it when the server cannot be reached, and tries again', async ({ page }) => {
  await pack(page, 'offline()');
  await page.getByRole('button', { name: 'Kacheln herunterladen' }).click();
  await expect(page.getByText('Pakete konnten nicht geladen werden')).toBeVisible();
  await pack(page, 'online()');
  await page.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(page.getByText('Innenstadt')).toBeVisible();
});

test('Offline-Bilder sits under Kartenkacheln: off, then on keeps the thumbnails and Dateien counts them', async ({
  page,
}) => {
  const card = page.getByTestId('images-card');
  const y = async (sel: string) => (await page.locator(sel).boundingBox())?.y ?? 0;
  expect(await y('[data-testid="tiles-card"]')).toBeLessThan(await y('[data-testid="images-card"]'));
  expect(await y('[data-testid="images-card"]')).toBeLessThan(await y('[data-testid="storage-section"]'));
  const sw = card.getByRole('switch', { name: 'Offline-Bilder' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(card.getByTestId('images-desc')).toContainText('werden offline keine Fotos angezeigt');
  await expect(page.getByTestId('count-files')).toContainText('0');

  await pack(page, 'holdThumbs()');
  await sw.click();
  await expect(card.getByTestId('images-busy')).toContainText('Vorschaubilder werden heruntergeladen...');
  await expect(card.getByTestId('images-busy').locator('svg.animate-spin')).toBeVisible();
  await expect(card.getByTestId('images-progress')).toContainText('(0/3)');
  await expect(sw).toBeDisabled();
  await pack(page, 'releaseThumbs()');
  await expect(card.getByTestId('images-on')).toHaveText(
    'Foto-Vorschauen sind für die Offline-Ansicht gespeichert.',
  );
  expect(await pack(page, 'thumbs()')).toBe(3);
  expect(await pack(page, 'pref()')).toBe(true);
  await expect(page.getByTestId('count-files')).toContainText('3');
  expect(await scan(page)).toEqual([]);

  await sw.click();
  await expect(card.getByTestId('images-desc')).toBeVisible();
  expect(await pack(page, 'thumbs()')).toBe(0);
  await expect(page.getByTestId('count-files')).toContainText('0');
});

test('Speicher: usage of the quota with its bar, the counts and persistent storage', async ({ page }) => {
  const section = page.getByTestId('storage-section');
  await expect(section.getByRole('heading', { name: 'Speicher' })).toBeVisible();
  await expect(section.getByText('512,0 MB von 2,0 GB')).toBeVisible();
  await expect(section.getByText('25,0%')).toBeVisible();
  await expect(section.getByTestId('count-records')).toContainText('4.711');
  await expect(section.getByTestId('persistent')).toHaveText('Aktiviert');
  const fill = section.locator('[data-level]');
  expect(await fill.evaluate((e) => (e as HTMLElement).style.width)).toBe('25%');
  expect(await fill.evaluate((e) => getComputedStyle(e).transitionProperty)).toBe('all');
});

// Real-browser axe scan (WCAG 2.1 A and AA, colour contrast included) at both sizes; no rule is filtered out and no
// finding is allowed. (v3's text-*-600 greens, oranges and yellows fail the 4.5:1 contrast; the text uses -700.) The jsdom spec's landmark filter is not needed here: that rule is not in the WCAG tag set.
test.describe('axe', () => {
  test('the open Offline tab has no violations', async ({ page }) => {
    await expect(page.getByTestId('storage-section')).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test('the open pack dialog has no violations', async ({ page }) => {
    await page.getByRole('button', { name: 'Kacheln herunterladen' }).click();
    await expect(page.getByText('Zoom: 12–17')).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test('the pack dialog with a refused import has no violations', async ({ page }) => {
    await page.getByRole('button', { name: 'Kacheln herunterladen' }).click();
    await page
      .getByTestId('import-input')
      .setInputFiles({ name: 'x.ubpack', mimeType: 'application/octet-stream', buffer: Buffer.from('no') });
    await expect(page.getByTestId('import-failed')).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test('the download card has no violations while a pack downloads', async ({ page }) => {
    await pack(page, 'hold()');
    await page.getByRole('button', { name: 'Kacheln herunterladen' }).click();
    await page.getByRole('button', { name: 'Herunterladen', exact: true }).click();
    await expect(page.getByTestId('download-card')).toBeVisible();
    expect(await scan(page)).toEqual([]);
    await pack(page, 'release()');
  });
});
