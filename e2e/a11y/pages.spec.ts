import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { seedControl, type Seeded } from '../../apps/web/e2e/seed';
import { A11Y_DATA_DIR } from './playwright.config';
import { scan, stale, unexpected, type Ledger } from './axe';
import { embedRefs } from '../../scripts/embed-refs.mjs';

/** WP-554: axe (WCAG 2.1 A/AA, contrast included), keyboard, reflow and reduced-motion checks on the real pages. */

let seeded: Seeded;
test.beforeAll(async () => {
  seeded = await seedControl(A11Y_DATA_DIR, ['musterstadt']);
});

type Cookies = Awaited<ReturnType<Page['context']>> extends { cookies: () => Promise<infer C> } ? C : never;
let session: Cookies | undefined;

/** A TOTP code is single-use, so the admin logs in once and later tests reuse the session cookies. */
async function login(page: Page): Promise<void> {
  if (session === undefined) {
    const r = await page.request.post('/api/auth/login', {
      data: { email: seeded.email, password: seeded.password, totp: seeded.totp() },
    });
    expect(r.status()).toBe(200);
    session = await page.context().cookies();
    // the builder shows a project file only once a version is deployed
    const overlay = fileURLToPath(
      new URL('../../fixtures/golden/projects/musterstadt-baeume.yaml', import.meta.url),
    );
    const deploy = await page.request.post('/api/admin/p/musterstadt/deploy', {
      data: embedRefs(
        parse(readFileSync(overlay, 'utf8')),
        fileURLToPath(new URL('../../', import.meta.url)),
      ),
    });
    expect((await deploy.json()).ok).toBe(true);
  }
  await page.context().addCookies(session);
}

interface PageCase {
  readonly name: string;
  readonly path: string;
  readonly ledger: Ledger;
  readonly admin: boolean;
  /** The page is the real one, not the not-found page: its document title must match (a moved route fails here). */
  readonly title?: RegExp;
  /** A visible heading of the page (WP-484): the page rendered its content, not just a titled shell. */
  readonly heading?: RegExp;
  /** Follow-up work package while the page still scrolls sideways at 320 px. */
  readonly reflowFix?: string;
  /** Follow-up work package while text still clips under the WCAG 1.4.12 spacing overrides. */
  readonly clipFix?: string;
}

const pages: readonly PageCase[] = [
  { name: 'not-found page', path: '/does-not-exist', ledger: {}, admin: false },
  { name: 'Projekte', path: '/admin/projects', ledger: {}, admin: true, title: /Projekte|Projects/ },
  {
    name: 'data page of an Objektart',
    path: '/admin/projects/musterstadt/types/baum',
    ledger: {},
    admin: true,
    title: /Baum|Tree/,
  },
  {
    name: 'Objektart builder',
    path: '/admin/projects/musterstadt/types/baum/builder',
    ledger: {},
    admin: true,
    title: /baum - .*Builder/i,
    heading: /^(Struktur|Structure)$/,
  },
  {
    name: 'Versionen',
    path: '/admin/projects/musterstadt/versions',
    ledger: {},
    admin: true,
    title: /Versionen|Versions/,
  },
];

for (const { name, path, ledger, admin, reflowFix, clipFix, title, heading } of pages) {
  test.describe(name, () => {
    test.beforeEach(async ({ page }) => {
      if (admin) await login(page);
      await page.goto(path);
      if (title !== undefined) {
        await expect(page).toHaveTitle(title);
      }
      if (heading !== undefined) {
        await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
      }
    });

    test('no WCAG 2.1 A/AA violation beyond the ledger', async ({ page }) => {
      const found = await scan(page);
      expect(unexpected(found, ledger)).toEqual([]);
    });

    test('ledger is current (a fixed failure leaves the ledger)', async ({ page }) => {
      expect(stale(await scan(page), ledger)).toEqual([]);
    });

    test('reflows at 320 px without horizontal scrolling (WCAG 1.4.10)', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
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
      // a known failure must still fail here: when it is fixed, drop reflowFix
      if (reflowFix === undefined) expect(overflow, wide.join('\n')).toBeLessThanOrEqual(0);
      else expect(overflow, `fixed by ${reflowFix}? then remove reflowFix`).toBeGreaterThan(0);
    });

    test('text spacing overrides clip no text (WCAG 1.4.12)', async ({ page }) => {
      await page.addStyleTag({
        content:
          '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }',
      });
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll('body *')]
          .filter((el) => {
            // visually hidden text (sr-only) is clipped by design
            if (el.classList.contains('sr-only')) return false;
            // the canvas is a pannable viewport: it scrolls its nodes into view, it does not clip text
            if (el.classList.contains('svelte-flow')) return false;
            const s = getComputedStyle(el);
            const hidden = s.overflowX === 'hidden' || s.overflowY === 'hidden';
            return hidden && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
          })
          .map((el) => el.tagName.toLowerCase() + '.' + el.className),
      );
      // a known failure must still fail here: when it is fixed, drop clipFix
      if (clipFix === undefined) expect(clipped).toEqual([]);
      else expect(clipped.length, `fixed by ${clipFix}? then remove clipFix`).toBeGreaterThan(0);
    });

    test('the viewport does not block zoom (WCAG 1.4.4)', async ({ page }) => {
      const content = await page.locator('meta[name="viewport"]').getAttribute('content');
      expect(content ?? '').not.toMatch(/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/);
    });

    test('animations and transitions stop under prefers-reduced-motion (WCAG 2.3.3)', async ({ page }) => {
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

    test('the page has a language, and every Tab stop shows a focus indicator', async ({ page }) => {
      expect(await page.evaluate(() => document.documentElement.lang)).toMatch(/^(de|en)/);
      const seen: string[] = [];
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        const state = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const s = getComputedStyle(el);
          const visible = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
          return { tag: el.tagName, visible: visible || s.boxShadow !== 'none' };
        });
        if (state === null) break;
        seen.push(`${state.tag}:${state.visible}`);
      }
      expect(seen.filter((s) => s.endsWith('false'))).toEqual([]);
    });
  });
}

/**
 * The Objektart's builder (v3 `builder/+page.svelte`; WP-320 moved it under /admin) has three centre views
 * (Workflow, Modell, Code), and at phone width its catalog and inspector are sheets (WP-345). Each view, and
 * each sheet open over the canvas, must reflow at 320 px.
 */
test('every builder view and sheet reflows at 320 px without page-level horizontal scrolling (WCAG 1.4.10)', async ({
  page,
}) => {
  await login(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/admin/projects/musterstadt/types/baum/builder');
  const frame = page.getByTestId('builder-frame');
  await expect(frame).toBeVisible();
  const overflow = (label: string): Promise<string | null> =>
    page.evaluate((what) => {
      const width = window.innerWidth;
      const over = document.documentElement.scrollWidth - width;
      if (over <= 0) return null;
      const wide = [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > width + 0.5)
        .slice(0, 6)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
      return `${what}: +${over}px ${wide.join(' ')}`;
    }, label);
  const failures: (string | null)[] = [];
  const views = frame.locator('.view-toggle button');
  expect(await views.count()).toBe(3);
  for (let i = 0; i < 3; i++) {
    await views.nth(i).click();
    failures.push(await overflow(`view ${i}`));
  }
  await views.nth(0).click();
  for (const sheet of ['open-catalog', 'open-inspector']) {
    await frame.getByTestId(sheet).click();
    failures.push(await overflow(sheet));
    await page.keyboard.press('Escape');
  }
  expect(failures.filter((f) => f !== null)).toEqual([]);
});
