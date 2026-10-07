import { expect, test } from '@playwright/test';
import { runAxe, settleAnimations } from '../../../e2e/a11y/axe';

// WP-1042: the shared axe helper waits for running animations before it scans. Static pages, no server needed.
const html = (css: string, body: string): string =>
  `<!doctype html><html lang="en"><head><title>t</title><style>${css}</style></head><body><main>${body}</main></body></html>`;

test('a running animation is scanned only after it finished', async ({ page }) => {
  await page.setContent(
    html(
      '@keyframes fade{from{opacity:0}to{opacity:1}}p{color:#000;background:#fff;animation:fade 400ms linear forwards}',
      '<p>Hello</p>',
    ),
  );
  const run = await runAxe(page);
  expect(run.settled).toBe(true);
  // mid-fade the text is semi-transparent and axe would report colour-contrast
  expect(run.violations.map((v) => v.id)).not.toContain('color-contrast');
  expect(await page.evaluate(() => document.getAnimations().every((a) => a.playState === 'finished'))).toBe(
    true,
  );
});

test('an animation longer than the bound is flagged and scanned anyway', async ({ page }) => {
  await page.setContent(
    html('@keyframes f{from{opacity:.5}to{opacity:1}}p{animation:f 10s linear}', '<p>Hello</p>'),
  );
  const run = await runAxe(page, { settleMs: 200 });
  expect(run.settled).toBe(false);
});

test('an infinite animation does not hold the scan', async ({ page }) => {
  await page.setContent(
    html('@keyframes s{to{transform:rotate(1turn)}}p{animation:s 1s linear infinite}', '<p>Hello</p>'),
  );
  expect(await settleAnimations(page, 500)).toBe(true);
});

test('scope and rules apply, and axe is injected once', async ({ page }) => {
  await page.setContent(
    html(
      '',
      '<div id="a"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div><div id="b"><p>ok</p></div>',
    ),
  );
  expect((await runAxe(page)).violations.map((v) => v.id)).toContain('image-alt');
  expect((await runAxe(page, { scope: '#b' })).violations.map((v) => v.id)).not.toContain('image-alt');
  expect((await runAxe(page, { scope: page.locator('#a') })).violations.map((v) => v.id)).toContain(
    'image-alt',
  );
  expect(
    (await runAxe(page, { rules: { 'image-alt': { enabled: false } } })).violations.map((v) => v.id),
  ).not.toContain('image-alt');
  expect(await page.evaluate(() => document.querySelectorAll('script').length)).toBe(1);
});
