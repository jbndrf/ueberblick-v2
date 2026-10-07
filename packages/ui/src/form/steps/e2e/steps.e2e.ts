import { expect, test } from '@playwright/test';

/** v3's multi-step task at phone 390 and desktop 1280: "Schritt n von m", the map, one submit at the end. */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('a form + location task walks both steps and submits one run', async ({ page }) => {
  await expect(page.getByTestId('step-label')).toHaveText('Schritt 1 von 2');
  await page.getByLabel(/Befund/).fill('gesund');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByTestId('step-label')).toHaveText('Schritt 2 von 2');

  // the map opens by itself when the location step is reached; the pill confirms the spot
  await expect(page.getByRole('dialog', { name: 'Karte' })).toBeVisible();
  await page.getByRole('button', { name: 'Standort bestätigen' }).click();
  await expect(page.getByText('Standort gewählt')).toBeVisible();
  await expect(page.getByTestId('runs')).toHaveText('[]');

  await page.getByRole('button', { name: 'Absenden' }).click();
  await expect(page.getByText('Gespeichert. Wird jetzt gesendet.')).toBeVisible();
  const runs = JSON.parse((await page.getByTestId('runs').textContent()) ?? '[]');
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({
    task: 'pflege',
    featureId: 'f1',
    input: { befund: 'gesund', lage: { type: 'Point', coordinates: [7.1, 50.7] } },
  });
  await page.getByRole('button', { name: 'Schließen' }).click();
  await expect(page.getByTestId('closed')).toHaveText('closed');
});

test('a cancelled map pick keeps the step and can be repeated; Zurück keeps the first step', async ({
  page,
}) => {
  await page.getByLabel(/Befund/).fill('krank');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByText('Noch kein Standort gewählt')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Absenden' })).toBeDisabled();
  await page.getByRole('button', { name: 'Standort auf der Karte wählen' }).click();
  await page.getByRole('button', { name: 'Standort bestätigen' }).click();
  await expect(page.getByText('Standort gewählt')).toBeVisible();
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(page.getByLabel(/Befund/)).toHaveValue('krank');
});

test('the step page fits the screen: no horizontal scroll, buttons within reach', async ({ page }) => {
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(scroll).toBeLessThanOrEqual(0);
  const next = await page.getByRole('button', { name: 'Weiter' }).boundingBox();
  expect(next?.height ?? 0).toBeGreaterThanOrEqual(44);
});
