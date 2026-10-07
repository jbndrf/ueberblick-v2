import { devices, expect } from '@playwright/test';
import { allowErrors, watchErrors } from './world';
import { E2E_DATA_DIR } from '../../playwright.config';
import { rosterToken } from '../seed';
import { REFUSAL_KEY, signInAs, test } from './refused-world';

/**
 * WP-854: Aktivität shows a waiting run as the device planned it: the stage move and the fields the plan wrote
 * (v3 `activity-sections.ts:144-161`), and the same entry once the run is synced.
 */
test.use({ ...devices['Pixel 7'], locale: 'de-DE' });

const OFFLINE_NOISE =
  /participant sync:open: .*Failed to fetch|net::ERR_INTERNET_DISCONNECTED|Failed to load resource|AJAXError: Failed to fetch \(0\): .*\/tiles\//;

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

    for (const reloadOffline of [false, true]) {
      test(`${reloadOffline ? 'after an offline reload: ' : ''}a waiting Kontrolle shows "Verschoben nach: Maßnahme" and its planned fields; the synced entry says the same`, async ({
        page,
        context,
        world,
        request,
      }, info) => {
        expect(world.office).toBeDefined(); // seeds the project (worker fixture)
        // "Kontrolle durchführen" binds the Fläche the tree lies in: the office draws one around the seeded tree (idempotent by id)
        await request.post('/api/auth/exchange', {
          data: { token: rosterToken(E2E_DATA_DIR, REFUSAL_KEY, 'p-qact-office', ['verwaltung']) },
        });
        const area = await request.post(`/api/p/${REFUSAL_KEY}/runs`, {
          data: {
            id: '00000000-0000-7000-8000-0000000854a1',
            task: 'flaeche_anlegen',
            configVersion: 1,
            input: {
              name: 'Kontrollfläche',
              geometrie: {
                type: 'Polygon',
                coordinates: [
                  [
                    [10.4, 51.1],
                    [10.5, 51.1],
                    [10.5, 51.2],
                    [10.4, 51.2],
                    [10.4, 51.1],
                  ],
                ],
              },
            },
          },
        });
        expect(area.status(), await area.text()).toBe(200);
        await signInAs(
          page,
          `p-qact-${size}-${reloadOffline ? 'rl' : 'on'}-${info.repeatEachIndex}-${info.retry}`,
        );
        await page.getByRole('button', { name: 'Liste' }).click();
        await page
          .getByRole('button', { name: /^Baum #/ })
          .first()
          .click();
        await page.getByRole('button', { name: 'Liste' }).click();
        await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
          timeout: 30_000,
        });
        await context.setOffline(true);
        allowErrors(problems, OFFLINE_NOISE);
        if (reloadOffline) {
          // WP-865: the session starts offline, from the device's own copy
          await page.reload();
          await page.getByRole('button', { name: 'Liste' }).click();
          await page
            .getByRole('button', { name: /^Baum #/ })
            .first()
            .click();
        }
        await page.getByRole('button', { name: 'Kontrolle durchführen' }).click();
        await page.getByLabel('Vitalität (Stufe)').click();
        await page.getByText('4', { exact: true }).last().click();
        await page.getByLabel('Befund (Freitext)').fill(`Riss ${size} ${Date.now()}`);
        await page.getByRole('button', { name: 'Absenden' }).click();
        await expect(page.getByTestId('run-pending')).toBeVisible();
        await expect(page.getByTestId('run-pending')).toContainText('Noch nicht übertragen');

        await page.getByRole('tab', { name: 'Aktivität' }).click();
        // the plan moved the tree and set faellig_am and kontrolle_faellig: five values, like the synced entry
        // a repeat finds the visits an earlier run synced on the same tree: the waiting one is the one to look at
        const stage = page.getByTestId('activity-stage').filter({ hasText: 'Wartet auf Übertragung' });
        await expect(stage).toHaveCount(1);
        await expect(stage).toBeVisible();
        await expect(stage).toContainText('Verschoben nach: Maßnahme');
        await expect(page.getByTestId('activity-entry').first()).toBeVisible();
        await expect(page.getByTestId('activity-entry').first()).toContainText('5 Felder aktualisiert');

        await context.setOffline(false);
        await expect(page.getByTestId('run-pending')).toHaveCount(0, { timeout: 30_000 });
        await expect(stage).toHaveCount(0);
        await expect(page.getByTestId('activity-stage').first()).toBeVisible();
        await expect(page.getByTestId('activity-stage').first()).toContainText('Verschoben nach: Maßnahme');
        await expect(page.getByTestId('activity-entry').first()).toBeVisible();
        await expect(page.getByTestId('activity-entry').first()).toContainText('5 Felder aktualisiert');
      });
    }
  });
}
