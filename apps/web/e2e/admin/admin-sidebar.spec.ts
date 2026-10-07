import { expect, test, type Page } from '@playwright/test';
import { goldenFile } from '../golden';
import { admin, createAdmin, signInAs } from './sign-in';

/**
 * WP-343: the sidebar groups Objektarten and Tabellen (v3 `admin/+layout.svelte:395-545`): they list the draft's
 * types with an icon and the active entry; "+" creates a type in the draft and opens its builder; dragging an
 * Objektart writes the overlay order (desktop only).
 * WP-466: the admin sidebar inside a project (v3 `admin/+layout.svelte:354-373`): the project name, the amber draft
 * badge ("Nicht veröffentlicht" until the first publish) and v3's entries Projekteinstellungen, Teilnehmende, Rollen,
 * Beziehungen and Versionen. At phone (390x844) the sidebar is a sheet.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const SIZES = [
  { name: 'phone', viewport: { width: 390, height: 844 } },
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
] as const;

test.use({ locale: 'de-DE' });

test.beforeAll(() => {
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
});

/** At phone size the sidebar is a sheet: open it when it is closed. */
async function openSidebar(page: Page): Promise<void> {
  if (await page.getByTestId('group-types').isVisible()) return;
  await page.getByRole('button', { name: 'Seitenleiste umschalten' }).click();
  await expect(page.getByTestId('group-types')).toBeVisible();
}

/**
 * After a navigation started from the sheet: at phone size the sheet closes on the new page (WP-515, as v3), so wait
 * until it is gone before opening it again; checking it while it still animates out would find it "open".
 */
async function reopenAfterNavigate(page: Page, phone: boolean): Promise<void> {
  if (phone) await expect(page.getByTestId('group-types')).toBeHidden();
  await openSidebar(page);
}

const names = (page: Page): Promise<(string | null)[]> =>
  page
    .getByTestId('group-types')
    .getByRole('link')
    .evaluateAll((links) => links.map((a) => a.textContent?.trim() ?? null));

for (const size of SIZES) {
  test.describe(`${size.name} (${size.viewport.width}x${size.viewport.height})`, () => {
    test.use({ viewport: size.viewport });

    test('journey: inside a project the sidebar shows the draft badge and the project entries', async ({
      page,
    }) => {
      const email = `sidebar-badge-${size.name}@example.org`;
      createAdmin(email);
      await signInAs(page, email);
      await expect(page).toHaveURL(/\/admin\/projects/);
      await page.goto('/admin/projects/new');
      await page.getByLabel('Projektname').fill(`Seitenleiste ${size.name}`);
      await page.getByLabel('Vorlage').selectOption('baumkataster@1');
      await page.getByRole('button', { name: 'Projekt erstellen' }).click();
      const project = `seitenleiste_${size.name}`;
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${project}/participants$`));

      if (!(await page.getByTestId('draft-badge').isVisible()))
        await page.getByRole('button', { name: 'Seitenleiste umschalten' }).click();
      await expect(page.getByTestId('draft-badge')).toContainText('Nicht veröffentlicht');
      await expect(page.getByTestId('draft-badge')).toHaveAttribute(
        'href',
        `/admin/projects/${project}/versions`,
      );
      const link = (name: string) => page.getByRole('link', { name, exact: true });
      await expect(link('Projekteinstellungen')).toHaveAttribute(
        'href',
        `/admin/projects/${project}/settings`,
      );
      await expect(link('Teilnehmende')).toBeVisible();
      await expect(link('Rollen')).toBeVisible();
      await expect(link('Beziehungen')).toBeVisible();
      await expect(link('Versionen')).toBeVisible();
    });

    test('journey: the groups list the types, + creates one in the draft, drag reorders (desktop)', async ({
      page,
    }) => {
      const email = `sidebar-${size.name}@example.org`;
      createAdmin(email);
      await signInAs(page, email);
      await expect(page).toHaveURL(/\/admin\/projects/);
      await page.goto('/admin/projects/new');
      await page.getByLabel('Projektname').fill(`Seite ${size.name}`);
      await page.getByLabel('Vorlage').selectOption('baumkataster@1');
      await page.getByRole('button', { name: 'Projekt erstellen' }).click();
      const project = `seite_${size.name}`;
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${project}/participants$`));

      // The lists: Objektarten with a geometry, Tabellen without; an Objektart opens its data page (S3-18).
      await openSidebar(page);
      const types = page.getByTestId('group-types');
      await expect(types.getByRole('link', { name: 'Baum', exact: true })).toHaveAttribute(
        'href',
        `/admin/projects/${project}/types/baum`,
      );
      await expect(types.getByRole('link', { name: 'Fläche' })).toBeVisible();
      await expect(types.locator('a svg').first()).toBeVisible();
      await expect(page.getByTestId('group-tables').getByRole('link', { name: 'Baumart' })).toBeVisible();

      // "+" -> name -> the type exists in the draft, its builder opens, the publish bar shows.
      await types.getByRole('button', { name: 'Objektart hinzufügen' }).click();
      await page.getByRole('menuitem', { name: 'Neue Objektart' }).click();
      await page.getByTestId('new-type-name').fill('Spielplatz');
      await page.getByTestId('new-type-create').click();
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${project}/types/spielplatz/builder$`));
      await expect(page.getByTestId('publish-bar')).toContainText('Nicht veröffentlicht');
      await reopenAfterNavigate(page, size.name === 'phone');
      await expect(page.getByTestId('group-types').getByRole('link', { name: 'Spielplatz' })).toHaveAttribute(
        'data-active',
        'true',
      );

      // The new Tabelle goes into its own group.
      await page.getByTestId('group-tables').getByRole('button', { name: 'Tabelle hinzufügen' }).click();
      await page.getByRole('menuitem', { name: 'Neue Tabelle' }).click();
      await page.getByTestId('new-type-name').fill('Strassen');
      await page.getByTestId('new-type-create').click();
      await expect(page).toHaveURL(new RegExp(`/admin/projects/${project}/tables/strassen$`));
      await reopenAfterNavigate(page, size.name === 'phone');
      await expect(page.getByTestId('group-tables').getByRole('link', { name: 'Strassen' })).toBeVisible();

      // Drag reorder needs a pointer: desktop only (as in v3, HTML5 drag does not work by touch).
      if (size.name === 'desktop') {
        const before = await names(page);
        expect(before).toContain('Spielplatz');
        const last = page.getByTestId('type-entry-spielplatz');
        await last.dragTo(page.getByTestId('type-entry-baum'), { targetPosition: { x: 20, y: 2 } });
        const rest = before.filter((n) => n !== 'Spielplatz');
        const expected = [
          ...rest.slice(0, rest.indexOf('Baum')),
          'Spielplatz',
          ...rest.slice(rest.indexOf('Baum')),
        ];
        await expect.poll(() => names(page)).toEqual(expected);
        await page.reload();
        await expect.poll(() => names(page)).toEqual(expected);
      }
    });
  });
}
