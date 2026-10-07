import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { goldenFile } from '../golden';
import { admin, createAdmin, PASSWORD, signInAs } from './sign-in';

/**
 * WP-408: the kit's sortable list in the two column managers (Tabellen and Teilnehmende), at phone (390x844) and desktop
 * (1280x800) size. Desktop: drag the row, or ArrowUp/ArrowDown on the grip. Phone: HTML5 drag has no touch, so the up and
 * down buttons of each row do it. The order survives a reload (a draft edit for Tabellen, the roster for Teilnehmende).
 * The sidebar's drag is proven in `admin-sidebar.spec.ts`.
 */
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const OVERLAY = goldenFile('projects/musterstadt-baeume.yaml');
const PROJECT = 'sortstadt';
const DEPLOYER = 'sortdeploy@example.org';
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;

test.use({ locale: 'de-DE' });
test.describe.configure({ mode: 'serial' });

let admins = 0;
async function signIn(page: Page): Promise<void> {
  const email = `sort${(admins += 1)}@example.org`;
  createAdmin(email);
  expect(admin(['add-membership', email, PROJECT, 'verwaltung']).status).toBe(0);
  await signInAs(page, email);
  await expect(page).toHaveURL(/\/admin\/projects/);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(180_000);
  expect(admin(['create-project', PROJECT, PROJECT]).status).toBe(0);
  createAdmin(DEPLOYER);
  expect(admin(['add-membership', DEPLOYER, PROJECT, 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  expect(
    (await ctx.post('/api/auth/login', { data: { email: DEPLOYER, password: PASSWORD } })).status(),
  ).toBe(200);
  const file = parse(readFileSync(OVERLAY, 'utf8')) as Record<string, unknown>;
  expect(await (await ctx.post(`/api/admin/p/${PROJECT}/deploy`, { data: file })).json()).toMatchObject({
    ok: true,
  });
  await ctx.dispose();
});

/** The names of the rows of a manager, top to bottom. */
const names = (manager: Locator): Promise<string[]> =>
  manager.getByRole('listitem').locator('p.font-medium').allTextContents();

/** Moves the row `label` one place up or down the way the device allows: buttons on a phone, the grip's keys on a desktop. */
async function step(
  page: Page,
  manager: Locator,
  phone: boolean,
  label: string,
  dir: 'up' | 'down',
): Promise<void> {
  if (phone) {
    await manager
      .getByRole('button', { name: `${dir === 'up' ? 'Nach oben' : 'Nach unten'}: ${label}` })
      .click();
  } else {
    await manager.getByRole('button', { name: `Verschieben: ${label}` }).focus();
    await page.keyboard.press(dir === 'up' ? 'ArrowUp' : 'ArrowDown');
  }
}

for (const [size, viewport] of Object.entries(VIEWPORTS)) {
  const phone = size === 'phone';
  test.describe(`${size} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport });

    test('Tabellen: the column manager orders by grip, keys or buttons; the order is kept', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(`/admin/projects/${PROJECT}/tables/baumart`);
      const open = async (): Promise<Locator> => {
        await page
          .getByRole('columnheader')
          .last()
          .getByRole('button', { name: 'Spalte hinzufügen' })
          .click();
        return page.getByTestId('column-manager');
      };
      let manager = await open();
      await expect(manager.getByRole('listitem').first()).toBeVisible();
      const before = await names(manager);
      expect(before.length).toBeGreaterThanOrEqual(2);
      const second = before[1] as string;

      if (phone) {
        // The grip drags too where the browser can; the buttons are the fallback and the phone shows them.
        await expect(manager.getByRole('button', { name: `Nach oben: ${second}` })).toBeVisible();
      } else {
        await expect(manager.getByRole('button', { name: `Nach oben: ${second}` })).toBeHidden();
        // Drag the second row to the top half of the first.
        await manager
          .getByRole('listitem')
          .nth(1)
          .dragTo(manager.getByRole('listitem').first(), {
            targetPosition: { x: 40, y: 2 },
          });
        await expect.poll(() => names(manager)).toEqual([second, ...before.filter((n) => n !== second)]);
        await step(page, manager, phone, second, 'down'); // the keyboard puts it back
        await expect.poll(() => names(manager)).toEqual(before);
      }
      if (phone) {
        await step(page, manager, phone, second, 'up');
        await expect.poll(() => names(manager)).toEqual([second, ...before.filter((n) => n !== second)]);
      }
      await expect(manager.getByRole('listitem').first().getByText('Haupt')).toBeVisible();
      await page.keyboard.press('Escape');

      // kept: the new order is in the draft
      const expected = phone ? [second, ...before.filter((n) => n !== second)] : before;
      await page.reload();
      manager = await open();
      await expect.poll(() => names(manager)).toEqual(expected);
      if (phone) await step(page, manager, phone, second, 'down'); // leave the order as found for the next test
      await expect(page.locator('body')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    test('Teilnehmende: the field manager orders the roster columns by grip, keys or buttons', async ({
      page,
    }) => {
      await signIn(page);
      await page.goto(`/admin/projects/${PROJECT}/participants`);
      const open = async (): Promise<Locator> => {
        await page.getByRole('button', { name: 'Feld hinzufügen' }).click();
        return page.getByRole('dialog', { name: /Benutzerdefinierte Felder/ });
      };
      let manager = await open();
      const [alpha, beta] = [`Alpha ${size}`, `Beta ${size}`];
      for (const label of [alpha, beta]) {
        await manager.getByRole('button', { name: 'Feld hinzufügen' }).click();
        const form = page.getByRole('dialog', { name: 'Feld hinzufügen' });
        await form.getByLabel('Feldname').fill(label);
        await form.getByRole('button', { name: 'Erstellen' }).click();
        await expect(manager.getByText(label, { exact: true })).toBeVisible();
      }
      const own = async (): Promise<string[]> => (await names(manager)).filter((n) => n.endsWith(` ${size}`));
      await expect.poll(own).toEqual([alpha, beta]);

      if (phone) {
        await step(page, manager, phone, beta, 'up');
      } else {
        await manager
          .getByRole('listitem')
          .filter({ hasText: beta })
          .dragTo(manager.getByRole('listitem').filter({ hasText: alpha }), {
            targetPosition: { x: 40, y: 2 },
          });
      }
      await expect.poll(own).toEqual([beta, alpha]);

      // kept: the roster's columns follow the saved order
      await manager.getByRole('button', { name: 'Schließen', exact: true }).first().click();
      await page.reload();
      manager = await open();
      await expect.poll(own).toEqual([beta, alpha]);
      await step(page, manager, phone, beta, 'down'); // the other way, with the keys on a desktop
      await expect.poll(own).toEqual([alpha, beta]);
    });
  });
}

test.describe('sidebar (desktop 1280x800)', () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test('Objektarten drag into order, Alt+ArrowUp/ArrowDown moves the focused entry, Tabellen stay put', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(`/admin/projects/${PROJECT}/participants`);
    const types = page.getByTestId('group-types');
    const order = (): Promise<(string | null)[]> =>
      types
        .locator('[data-sortable-id]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-sortable-id')));
    const start = await order();
    expect(start.sort()).toEqual(['baum', 'flaeche']);
    const first = (await order())[0] as string;
    const last = (await order())[1] as string;
    await expect(page.getByTestId('type-entry-baumart')).toHaveAttribute('draggable', 'false');

    await page.getByTestId(`type-entry-${last}`).dragTo(page.getByTestId(`type-entry-${first}`), {
      targetPosition: { x: 20, y: 2 },
    });
    await expect.poll(order).toEqual([last, first]);
    await page.reload();
    await expect.poll(order).toEqual([last, first]);

    // the keyboard: Alt+ArrowDown on the first entry puts it back, and it keeps focus
    const link = page.getByTestId(`type-entry-${last}`).getByRole('link');
    await link.focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(order).toEqual([first, last]);
    await expect(link).toBeFocused();
  });
});
