import { expect, test, type APIRequestContext } from '@playwright/test';
import { issueToken, issueTokenOfOther, seedWorld } from './world';

/** WP-608: the participant's addresses, against the built process. Redirects are read, not followed. */
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
});

const exchange = (ctx: APIRequestContext, token: string) =>
  ctx.post('/api/auth/exchange', { data: { token } });

test('/ leads to /login without a session and to /map with one', async ({ playwright, baseURL }) => {
  const ctx = await playwright.request.newContext({ baseURL });
  const anonymous = await ctx.get('/', { maxRedirects: 0 });
  expect(anonymous.status()).toBe(303);
  expect(anonymous.headers()['location']).toBe('/login');
  expect((await exchange(ctx, issueToken())).status()).toBe(200);
  const signedIn = await ctx.get('/', { maxRedirects: 0 });
  expect(signedIn.status()).toBe(303);
  expect(signedIn.headers()['location']).toBe('/map');
});

test('a second sign-in on the same device replaces the first session', async ({ playwright, baseURL }) => {
  const ctx = await playwright.request.newContext({ baseURL });
  const first = await exchange(ctx, issueToken());
  const cookie = first.headers()['set-cookie'] ?? '';
  const old = cookie.split(';')[0] ?? '';
  expect((await exchange(ctx, issueTokenOfOther())).status()).toBe(200);
  const stale = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie: old } });
  const res = await stale.get('/', { maxRedirects: 0 });
  expect(res.headers()['location']).toBe('/login');
});

for (const method of ['GET', 'POST'] as const) {
  test(`/logout (${method}) ends the session and goes to /login`, async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL });
    expect((await exchange(ctx, issueToken())).status()).toBe(200);
    const out = await ctx.fetch('/logout', { method, maxRedirects: 0 });
    expect(out.status()).toBe(303);
    expect(out.headers()['location']).toBe('/login');
    const after = await ctx.get('/', { maxRedirects: 0 });
    expect(after.headers()['location']).toBe('/login');
  });
}
