import { devices, expect, type Locator, type Page } from '@playwright/test';
import { allowErrors, watchErrors } from './world';
import { CENTER, PACK_KEY, signInStep5, STEP5_KEY, test, unique } from './helpers/step5-world';

/**
 * WP-843 (step-5 verify): advanced features, Projekt-Chat and offline packs, driven in the real participant UI at
 * Pixel 7 (phone) and 1280x800 (desktop), de-DE, against its own project (`step5stadt`, helpers/step5-world.ts).
 * v3 sources: `AdvancedFeaturesPanel.svelte:20-111`, `FilterSheet.svelte:643-708` (Cluster, "Tabs verwalten"),
 * `unread-store.svelte.ts:324-343` and `BottomControlBar.svelte:105` (the badge), `ChatSheet.svelte`,
 * `Module:485-492,1115-1139` ("Im Chat erwähnen"), `SettingsSheet.svelte:644-748`, `package-selector.svelte`.
 */
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });
test.setTimeout(90_000);

const OFFLINE_NOISE =
  /participant sync:open: .*Failed to fetch|net::ERR_INTERNET_DISCONNECTED|Failed to load resource|AJAXError: Failed to fetch \(0\): .*\/tiles\//;

const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 600;
/** Where the Werkzeuge badge sits: the bar on a phone, the header icon on a desktop. */
const chrome = (page: Page): Locator =>
  isPhone(page) ? page.getByRole('navigation', { name: 'Kartenleiste' }) : page.getByRole('banner');

async function openOptionen(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  const sheet = page.getByRole('dialog', { name: 'Einstellungen' });
  await sheet.getByRole('tab', { name: 'Optionen' }).click();
  return sheet;
}

/** Opens the box "Erweiterte Funktionen" of Optionen and returns the switch of a tool. */
async function toolSwitch(page: Page, name: string): Promise<Locator> {
  const sheet = await openOptionen(page);
  const box = sheet.getByRole('button', { name: /Erweiterte Funktionen/ });
  if ((await box.getAttribute('aria-expanded')) !== 'true') await box.click();
  return sheet.getByRole('switch', { name, exact: true });
}

/** The chat's message list has a height and the composer sits below it (v3 `ChatSheet.svelte:143-170`). */
async function expectListAboveComposer(page: Page): Promise<void> {
  const log = page.getByRole('log', { name: 'Nachrichten' });
  await expect(log).toBeVisible();
  const list = await log.boundingBox();
  const composer = await page.getByRole('textbox', { name: 'Nachricht schreiben' }).boundingBox();
  expect(list?.height ?? 0).toBeGreaterThan(40);
  expect((composer?.y ?? 0) >= (list?.y ?? 0) + (list?.height ?? 0) - 1).toBe(true);
}

async function openFilter(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Filter' }).click();
  const sheet = page.getByRole('dialog', { name: 'Karteninhalt' });
  await expect(sheet).toBeVisible();
  return sheet;
}

for (const size of ['phone', 'desktop'] as const) {
  test.describe(size, () => {
    if (size === 'desktop')
      test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });
    let problems: string[] = [];
    test.beforeEach(({ page }) => {
      problems = watchErrors(page);
    });
    test.afterEach(() => {
      expect(problems).toEqual([]);
    });

    // v3 `AdvancedFeaturesPanel.svelte:20-111` (switch "Views" adds the Ansichten tab), `FilterSheet.svelte` tabs.
    test('Advanced features: the switch "Ansichten" adds the Ansichten tab of Karteninhalt, off takes it away', async ({
      page,
      world,
    }, info) => {
      expect(world).toBeDefined();
      await signInStep5(page, unique('p-views', size, info));
      // the plain map: no Ansichten tab
      let filter = await openFilter(page);
      await expect(filter.getByRole('tab', { name: 'Ansichten' })).toHaveCount(0);
      // Optionen: the collapsible box lists the switch, off at first
      const views = await toolSwitch(page, 'Ansichten');
      await expect(views).toHaveAttribute('aria-checked', 'false');
      await views.click();
      await expect(views).toHaveAttribute('aria-checked', 'true');
      filter = await openFilter(page);
      await expect(filter.getByRole('tab', { name: 'Einfach' })).toBeVisible();
      await filter.getByRole('tab', { name: 'Ansichten' }).click();
      await expect(filter.getByRole('tab', { name: 'Ansichten' })).toHaveAttribute('aria-selected', 'true');
      // back off: the tab goes
      await (await toolSwitch(page, 'Ansichten')).click();
      filter = await openFilter(page);
      await expect(filter.getByRole('tab', { name: 'Ansichten' })).toHaveCount(0);
    });

    // v3 `AdvancedFeaturesPanel.svelte`, `FilterSheet.svelte:643-688` (Cluster tab: "Gruppierung aufheben").
    test('Advanced features: the switch "Cluster" adds the Cluster tab with "Gruppierung aufheben"', async ({
      page,
      world,
    }, info) => {
      for (const i of [0, 1, 2])
        await world.plant(unique(`Pulk${i}`, size, info), [CENTER[0] + i * 0.0003, CENTER[1]]);
      await signInStep5(page, unique('p-cluster', size, info));
      let filter = await openFilter(page);
      await expect(filter.getByRole('tab', { name: 'Cluster' })).toHaveCount(0);
      const cluster = await toolSwitch(page, 'Cluster');
      await expect(cluster).toHaveAttribute('aria-checked', 'false');
      await cluster.click();
      await expect(cluster).toHaveAttribute('aria-checked', 'true');
      // the count of what is switched on (the chat was already on) shows beside the box title
      await expect(page.getByRole('button', { name: /Erweiterte Funktionen/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /Erweiterte Funktionen/ })).toContainText('2');
      filter = await openFilter(page);
      await filter.getByRole('tab', { name: 'Cluster' }).click();
      const dissolve = filter.getByRole('switch', { name: 'Gruppierung aufheben' });
      await expect(dissolve).toHaveAttribute('aria-checked', 'false');
      await dissolve.click();
      await expect(dissolve).toHaveAttribute('aria-checked', 'true');
      await expect(filter.getByText(/einzeln angezeigt/)).toBeVisible();
      await (await toolSwitch(page, 'Cluster')).click();
      filter = await openFilter(page);
      await expect(filter.getByRole('tab', { name: 'Cluster' })).toHaveCount(0);
    });

    // v3 `unread-store.svelte.ts:324-343`, `BottomControlBar.svelte:105`, `ChatSheet.svelte`, `+page.svelte:2539`.
    test('Projekt-Chat: a grey dot for news, the red count for mentions, both cleared by reading', async ({
      page,
      world,
    }, info) => {
      const me = unique('p-chat', size, info);
      const colleague = 'p-step5-kollegin';
      await signInStep5(page, me);
      const where = chrome(page);
      await expect(where.getByText('1', { exact: true })).toHaveCount(0);
      await world.say(colleague, `Neuigkeit ${unique('n', size, info)}`);
      await expect(where.getByText('Ungelesen')).toHaveCount(1, { timeout: 30_000 });
      await expect(where.getByText('1', { exact: true })).toHaveCount(0); // news without a mention has no count
      const first = unique('erste', size, info);
      await world.say(colleague, `@${me} ${first}`);
      await expect(where.getByText('1', { exact: true })).toBeVisible({ timeout: 30_000 });
      await world.say(colleague, `@${me} ${unique('zweite', size, info)}`);
      await expect(where.getByText('2', { exact: true })).toBeVisible({ timeout: 30_000 });
      // the sheet tile carries the same count; opening the chat reads everything
      await page.getByRole('button', { name: 'Werkzeuge' }).click();
      const tile = page.getByRole('button', { name: /Projekt-Chat/ });
      await expect(tile).toBeVisible();
      await expect(tile).toContainText('2');
      await tile.click();
      const log = page.getByRole('log', { name: 'Nachrichten' });
      await expect(log).toBeVisible();
      await expect(log).toContainText(first, { timeout: 20_000 });
      await expectListAboveComposer(page); // a 0 px log still holds the text: it must be seen (WP-856)
      await expect(log.getByText(first)).toBeVisible();
      await expect(where.getByText('Ungelesen')).toHaveCount(0, { timeout: 20_000 });
      await expect(where.getByText('2', { exact: true })).toHaveCount(0);
    });

    // v3 `Module:485-492,1115-1139`, `+page.svelte:2254-2258`: the ⋮ menu of the feature seeds the composer.
    test('"Im Chat erwähnen": the feature menu opens the chat with "#id " in the composer; the message mentions the feature', async ({
      page,
      world,
    }, info) => {
      const name = unique('Chatbaum', size, info);
      const id = await world.plant(name, [CENTER[0] + 0.3, CENTER[1]]);
      const me = unique('p-mention', size, info);
      await signInStep5(page, me);
      await page.getByRole('button', { name: 'Liste' }).click();
      await page.getByRole('button', { name }).first().click();
      await page.getByRole('button', { name: 'Liste' }).click();
      await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
      await page.getByRole('menuitem', { name: 'Im Chat erwähnen' }).click();
      const composer = page.getByRole('textbox', { name: 'Nachricht schreiben' });
      await expect(composer).toHaveValue(`#${id} `, { timeout: 20_000 });
      // the chat opens beside the feature, which stays open
      await expect(page.getByRole('button', { name: 'Weitere Aktionen' })).toBeVisible();
      await composer.pressSequentially('bitte prüfen');
      await page.getByRole('button', { name: 'Senden' }).click();
      const log = page.getByRole('log', { name: 'Nachrichten' });
      await expect(log).toBeVisible();
      await expect(log).toContainText('bitte prüfen', { timeout: 20_000 });
      await expectListAboveComposer(page);
      await expect(log.getByText('bitte prüfen').last()).toBeVisible();
      await expect(log.locator(`button[data-chat="chip"][data-kind="feature"][data-id="${id}"]`)).toHaveCount(
        1,
      );
      // the server keeps the feature as a mention of the message
      await expect
        .poll(
          async () => {
            const r = await page.request.get(`/api/p/${STEP5_KEY}/tools/chat?after=0&limit=500`);
            const body = (await r.json()) as {
              messages: { body: string | null; mentions: { features: string[] } }[];
            };
            return body.messages.find((m) => m.body === `#${id} bitte prüfen`)?.mentions.features;
          },
          { timeout: 20_000 },
        )
        .toEqual([id]);
    });

    // v3 `SettingsSheet.svelte:644-748` (Kartenkacheln card), `package-selector.svelte` (Offline-Pakete dialog).
    test('offline packs: the pack list with zoom, tiles and size, the download, the card with change and delete, kept offline', async ({
      page,
      context,
      world,
    }, info) => {
      expect(world).toBeDefined();
      await signInStep5(page, unique('p-pack', size, info));
      await page.getByRole('button', { name: 'Einstellungen' }).click();
      const sheet = page.getByRole('dialog', { name: 'Einstellungen' });
      await sheet.getByRole('tab', { name: 'Offline' }).click();
      const card = sheet.getByTestId('tiles-card');
      await expect(card).toBeVisible();
      await expect(card).toContainText('Kartenkacheln');
      await expect(card).toContainText('Noch keine Kartenkacheln heruntergeladen');
      await card.getByRole('button', { name: 'Kacheln herunterladen' }).click();
      const dialog = page.getByTestId('package-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('Offline-Pakete');
      const row = dialog.locator(`[data-testid="pack-row"][data-pack="${PACK_KEY}"]`);
      await expect(row).toBeVisible();
      await expect(row).toContainText('Innenstadt');
      await expect(row).toContainText('Zoom: 1–3');
      await expect(row).toContainText(/\d+ Kacheln, /);
      await row.getByRole('button', { name: 'Herunterladen' }).click();
      await expect(row).toBeVisible();
      await expect(row).toContainText('Heruntergeladen', { timeout: 30_000 });
      await dialog.getByRole('button', { name: 'Schließen' }).last().click();
      // the card now shows the ready pack with its tile count and size, and the two actions
      const ready = card.locator(`[data-testid="ready-pack"][data-pack="${PACK_KEY}"]`);
      await expect(ready).toBeVisible();
      await expect(ready).toContainText('Innenstadt');
      await expect(ready).toContainText(/\d+ Kacheln\s+\(/);
      await expect(card.getByRole('button', { name: 'Bereich ändern' })).toBeVisible();
      // it is on the device: it survives a reload without network
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
        timeout: 30_000,
      });
      allowErrors(problems, OFFLINE_NOISE);
      await context.setOffline(true);
      await page.reload();
      await page.getByRole('button', { name: 'Einstellungen' }).click();
      await page.getByRole('dialog', { name: 'Einstellungen' }).getByRole('tab', { name: 'Offline' }).click();
      await expect(
        page.getByTestId('tiles-card').locator(`[data-testid="ready-pack"][data-pack="${PACK_KEY}"]`),
      ).toBeVisible({ timeout: 30_000 });
      await context.setOffline(false);
      // delete takes two steps
      const again = page.getByTestId('tiles-card');
      await again.getByRole('button', { name: 'Löschen', exact: true }).click();
      await again.getByRole('button', { name: 'Löschen bestätigen' }).click();
      await expect(again).toBeVisible();
      await expect(again).toContainText('Noch keine Kartenkacheln heruntergeladen');
    });
  });
}
