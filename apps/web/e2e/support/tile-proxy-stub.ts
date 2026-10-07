import type { Page } from '@playwright/test';

/** A 1x1 transparent PNG. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Answers every tile-proxy request (`/api/p/<project>/tiles/...`, WP-689: the browser never asks a provider) with a
 * tiny PNG, so a spec needs no network (the server's proxy would fetch from the provider). Returns the URLs requested.
 */
export async function stubTileProxy(page: Page): Promise<string[]> {
  const requested: string[] = [];
  await page.route('**/api/p/*/tiles/**', (route) => {
    requested.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
  });
  return requested;
}
