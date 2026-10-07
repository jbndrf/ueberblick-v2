import { expect, test } from '@playwright/test';

// WP-941, proxy mode (the default of the e2e server): the cross-site check refuses a form POST from another origin,
// forwarded headers from the (untrusted) test client change nothing, and the setup page has no CA to offer.
test('a cross-origin form POST is refused, a same-origin one reaches the handler', async ({
  request,
  baseURL,
}) => {
  const form = { 'content-type': 'application/x-www-form-urlencoded' };
  const other = await request.post('/api/auth/login', {
    headers: { ...form, origin: 'https://evil.example' },
    data: 'email=a&password=b',
  });
  expect(other.status()).toBe(403);
  const same = await request.post('/api/auth/login', {
    headers: { ...form, origin: baseURL ?? '' },
    data: 'email=a&password=b',
  });
  expect(same.status()).not.toBe(403);
});

test('X-Forwarded-* from an untrusted address is ignored (no redirect, no change of origin)', async ({
  request,
}) => {
  const res = await request.get('/api/health', {
    headers: {
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '203.0.113.7',
      'x-forwarded-host': 'evil.example',
    },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(200);
});

test('the setup page needs no sign-in and says there is nothing to set up without direct mode', async ({
  request,
}) => {
  const page = await request.get('/setup/zertifikat', { headers: { 'accept-language': 'en' } });
  expect(page.status()).toBe(200);
  expect(await page.text()).toContain('does not use its own certificate');
  expect((await request.get('/setup/zertifikat/ca.crt')).status()).toBe(404);
});
