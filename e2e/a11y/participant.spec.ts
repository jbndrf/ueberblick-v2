import { expect, test, type Page } from '@playwright/test';
import { issueToken, qrLink, seedWorld } from '../participant/world';
import { scan, stale, unexpected, type Ledger } from './axe';

/**
 * WP-554.5: the participant app on its real route, from the QR sign-in to the task submit. axe (WCAG 2.1 A/AA, contrast
 * included), keyboard paths and the screen-reader view (landmarks, roles, names). The golden layers are `$ref` styles
 * nothing resolves yet, so no map mounts here and the list alternative is the view; the map canvas is untested until
 * WP-577 (see the Log of WP-554.5). Each test signs in with a fresh one-time token.
 */
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
});

/** Known failures per screen: axe rule id -> follow-up work package. A fixed one must leave the ledger. */
const ledger: Readonly<Record<'login' | 'list' | 'sheet' | 'task', Ledger>> = {
  login: {},
  list: {},
  sheet: {},
  task: {},
};

async function signIn(page: Page): Promise<void> {
  await page.goto(qrLink(issueToken()));
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByRole('banner')).toBeVisible();
}

/** The list alternative: with no drawable layer it is already the view. */
const listRow = (page: Page) => page.getByRole('table').getByRole('cell').first().getByRole('button');

async function reachList(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'List', exact: true });
  // The map mounts once the offline packs are read, so the toggle may come after the header (WP-797): wait for the
  // toggle or the list (a map that cannot draw shows the list at once), never test for the toggle's presence right now.
  await expect(toggle.or(listRow(page))).toBeVisible();
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await expect(listRow(page)).toBeVisible(); // the first pull has delivered the tree
  // the loading status pulses until the map is idle; axe would measure its contrast mid-animation
  await expect(page.locator('[role="status"].animate-pulse')).toHaveCount(0);
}

async function checkScreen(page: Page, screen: keyof typeof ledger): Promise<void> {
  const found = await scan(page);
  expect(unexpected(found, ledger[screen]), screen).toEqual([]);
  expect(stale(found, ledger[screen]), `${screen}: ledger is current`).toEqual([]);
}

test.describe('sign-in page', () => {
  test('the sign-in page: heading, title, no WCAG violation beyond the ledger', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(/\S/);
    await checkScreen(page, 'login');
  });

  test('the sign-in page and the app have different, non-empty titles (WCAG 2.4.2)', async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveTitle(/\S/); // the app is client-only: the title is set once the page has mounted
    const appTitle = await page.title();
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(/\S/);
    expect(await page.title()).not.toBe(appTitle);
  });
});

test.describe('participant app', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('screen reader: language, landmarks and named controls; axe finds nothing beyond the ledger', async ({
    page,
  }) => {
    expect(await page.evaluate(() => document.documentElement.lang)).toMatch(/^(de|en)/);
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    // every button and link has an accessible name
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll('button, a[href], [role="button"]')]
        .filter((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim() === '')
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(unnamed).toEqual([]);
    await reachList(page);
    await checkScreen(page, 'list');
  });

  test('keyboard: the skip link is the first Tab stop and moves focus to main', async ({ page }) => {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /skip|zum inhalt/i })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('every Tab stop shows a focus indicator', async ({ page }) => {
    await reachList(page);
    const bad: string[] = [];
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      const state = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        const visible = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
        return { name: el.tagName + '.' + el.className, visible: visible || s.boxShadow !== 'none' };
      });
      if (state === null) break;
      if (!state.visible) bad.push(state.name);
    }
    expect(bad).toEqual([]);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`the focus ring is solid, 2px and at least 3:1 against the page, ${theme} (WCAG 2.4.11/2.4.13, WP-716)`, async ({
      page,
    }) => {
      await page.evaluate((t) => document.documentElement.classList.toggle('dark', t === 'dark'), theme);
      await reachList(page);
      await listRow(page).focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const s = getComputedStyle(el);
        const px = (css: string): number[] => {
          const c = document.createElement('canvas').getContext('2d');
          if (!c) return [0, 0, 0];
          c.fillStyle = '#000';
          c.fillStyle = css;
          c.fillRect(0, 0, 1, 1);
          return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        const lum = (rgb: number[]): number => {
          const [r = 0, g = 0, b = 0] = rgb.map((v) => {
            const x = v / 255;
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const a = lum(px(s.outlineColor));
        const b = lum(px(getComputedStyle(document.body).backgroundColor));
        return {
          style: s.outlineStyle,
          width: parseFloat(s.outlineWidth),
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        };
      });
      expect(ring.style).toBe('solid');
      expect(ring.width).toBeGreaterThanOrEqual(2);
      expect(ring.ratio).toBeGreaterThanOrEqual(3);
    });
  }

  test('dark theme: the list and its controls pass axe contrast (WP-716)', async ({ page }) => {
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await reachList(page);
    const found = await scan(page);
    expect(unexpected(found, ledger.list), 'dark list').toEqual([]);
  });

  test('reflows at 320 px without horizontal scrolling (WCAG 1.4.10)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await reachList(page);
    const { overflow, wide } = await page.evaluate(() => {
      const width = window.innerWidth;
      const wide = [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > width + 0.5)
        .slice(0, 10)
        .map(
          (el) =>
            `${el.tagName.toLowerCase()}.${el.className} right=${Math.round(el.getBoundingClientRect().right)}`,
        );
      return { overflow: document.documentElement.scrollWidth - width, wide };
    });
    expect(overflow, wide.join('\n')).toBeLessThanOrEqual(0);
  });

  test('text spacing overrides clip no text (WCAG 1.4.12)', async ({ page }) => {
    await reachList(page);
    await page.addStyleTag({
      content:
        '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }',
    });
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .filter((el) => {
          const s = getComputedStyle(el);
          const hidden = s.overflowX === 'hidden' || s.overflowY === 'hidden';
          // visually hidden text (screen-reader only, 1 px) is clipped on purpose
          if (el.clientWidth <= 1 || el.clientHeight <= 1) return false;
          return hidden && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
        })
        .map((el) => el.outerHTML.slice(0, 140)),
    );
    expect(clipped).toEqual([]);
  });

  test('the viewport does not block zoom, and motion stops under reduced motion', async ({ page }) => {
    const content = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(content ?? '').not.toMatch(/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const moving = await page.evaluate(
      () =>
        [...document.querySelectorAll('*')].filter((el) => {
          const s = getComputedStyle(el);
          return s.animationName !== 'none' && parseFloat(s.animationDuration) > 0;
        }).length,
    );
    expect(moving).toBe(0);
  });

  test('sheets open without a running animation under reduced motion (WP-701)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Computed styles, not document.getAnimations(): an animation that already finished would leave nothing to read.
    const still = (selector: string) =>
      page.evaluate((sel) => {
        const els = [...document.querySelectorAll(sel)];
        return els.map((el) => {
          const s = getComputedStyle(el);
          return {
            name: s.animationName,
            animationDuration: parseFloat(s.animationDuration),
            transition: s.transitionDuration.split(',').every((d) => parseFloat(d) === 0),
          };
        });
      }, selector);
    const expectStill = async (selector: string) => {
      const found = await still(selector);
      expect(found.length).toBeGreaterThan(0);
      for (const f of found) {
        // no animation (the kit sheet), or no transition time (the feature panel)
        expect(f.name === 'none' || f.animationDuration === 0 || f.transition).toBe(true);
      }
    };
    // the kit sheet (data-[state=open]:animate-in must lose to motion-reduce:animate-none!)
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectStill('[role="dialog"]');
    await page.keyboard.press('Escape');
    // the feature panel (a plain transition)
    await reachList(page);
    await listRow(page).click();
    await expect(page.getByRole('dialog', { name: /^Tree #\S{4}$/ })).toBeVisible();
    await expectStill('[role="dialog"]');
  });

  test('keyboard: the list opens a feature sheet; Escape closes it and focus returns', async ({ page }) => {
    await reachList(page);
    const row = listRow(page);
    await row.focus();
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog', { name: /^Tree #\S{4}$/ });
    await expect(sheet).toBeVisible();
    await checkScreen(page, 'sheet');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(row).toBeFocused();
  });

  test('keyboard and screen reader: a task is started, filled in and submitted without a pointer', async ({
    page,
  }) => {
    await reachList(page);
    await listRow(page).focus();
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog', { name: /^Tree #\S{4}$/ });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Add finding' }).focus();
    await page.keyboard.press('Enter');
    const field = page.getByRole('textbox', { name: 'Finding' });
    await expect(field).toBeVisible();
    await checkScreen(page, 'task');
    await field.focus();
    await page.keyboard.type('Riss im Stamm');
    await page.getByRole('button', { name: 'Submit' }).focus();
    await page.keyboard.press('Enter');
    // v3's form closes back to the feature sheet once the run is queued
    await expect(field).toBeHidden({ timeout: 15_000 });
    await expect(sheet).toBeVisible();
  });
});
