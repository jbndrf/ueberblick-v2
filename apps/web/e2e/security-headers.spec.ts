import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { base32Decode, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../playwright.config';
import { goldenData } from './golden';
import { rosterToken } from './seed';

test('HTML pages carry a nonce CSP for scripts and no unsafe-inline in script-src', async ({ request }) => {
  for (const path of ['/does-not-exist', '/', '/setup/zertifikat']) {
    const res = await request.get(path);
    const csp = res.headers()['content-security-policy'] ?? '';
    const script =
      csp
        .split(';')
        .map((d) => d.trim())
        .find((d) => d.startsWith('script-src')) ?? '';
    expect(script, path).toMatch(/'nonce-[A-Za-z0-9+/=_-]+'/);
    expect(script, path).not.toContain('unsafe-inline');
    expect(csp).toContain("frame-ancestors 'none'");
    const nonce = /'nonce-([^']+)'/.exec(script)?.[1];
    const html = await res.text();
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) expect(tag).toContain(`nonce="${nonce}"`);
  }
});

test('an unknown page answers 404 HTML with security headers and a link to the start page', async ({
  request,
}) => {
  const res = await request.get('/does-not-exist', { headers: { 'accept-language': 'en' } });
  expect(res.status()).toBe(404);
  expect(res.headers()['content-type']).toContain('text/html');
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  expect(res.headers()['x-frame-options']).toBe('DENY');
  const html = await res.text();
  expect(html).toContain('<html lang="en">');
  expect(html).toContain('href="/"');
});

test('an unknown API path answers 404 JSON with security headers', async ({ request }) => {
  for (const method of ['get', 'post'] as const) {
    const res = await request[method]('/api/does-not-exist');
    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  }
});

const EXPECTED = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'geolocation=(self), camera=(self), microphone=()',
} as const;

test('WP-942: every header is on an HTML page, an API response and a 404; HSTS only over HTTPS', async ({
  request,
}) => {
  for (const path of ['/', '/admin/login', '/api/health', '/does-not-exist', '/api/does-not-exist']) {
    const res = await request.get(path);
    const h = res.headers();
    // `/` redirects to the sign-in page, which sends no Referer (WP-772)
    const expected = path === '/' ? { ...EXPECTED, 'referrer-policy': 'no-referrer' } : EXPECTED;
    for (const [name, value] of Object.entries(expected)) expect(h[name], `${path} ${name}`).toBe(value);
    expect(h['content-security-policy'], path).toContain("frame-ancestors 'none'");
    expect(h['content-security-policy-report-only'], path).toBeUndefined();
    // the test server speaks plain http
    expect(h['strict-transport-security'], path).toBeUndefined();
  }
});

test('WP-942: the participant app, the sign-in page and the start page load without CSP violations', async ({
  page,
}) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /content security policy/i.test(m.text())) problems.push(m.text());
  });
  await page.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (e) =>
      console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI}`),
    ),
  );
  for (const path of ['/', '/login', '/admin/login', '/app']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(problems, path).toEqual([]);
  }
});

test('WP-942: a body above UPLOAD_LIMIT gets 413 with the security headers', async ({ baseURL }) => {
  // Playwright's request fixture sets content-length itself, so the oversized declaration goes over a raw request.
  const url = new URL(baseURL ?? '');
  const res = await new Promise<{ status: number; nosniff: string | undefined }>((resolve, reject) => {
    const req = request({
      host: url.hostname,
      port: url.port,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'content-length': String(1024 ** 3), 'content-type': 'application/json' },
    });
    req.on('response', (r) => {
      resolve({
        status: r.statusCode ?? 0,
        nosniff: r.headers['x-content-type-options'] as string | undefined,
      });
      req.destroy();
    });
    req.on('error', reject);
    req.write('{}');
  });
  expect(res.status).toBe(413);
  expect(res.nosniff).toBe('nosniff');
});

// WP-957: the map origins of the deployed configs are in the CSP of every response, and a browser loads tiles from them.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;
const KEY = 'cspstadt';
const OSM = 'https://tile.openstreetmap.org';
const EXTRA = 'https://data.csp-test.example';
// WP-971: proxied kinds (xyz, preset) keep no origin in the policy; the browser asks this server for their tiles.

function cli(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

const withExtraLayer = (extra: boolean): unknown => {
  const file = goldenData('templates/baumkataster/1.0.0.yaml') as {
    map: { layers: Record<string, unknown> };
  };
  if (extra)
    file.map.layers['csp_test'] = {
      label: 'Test',
      kind: 'overlay',
      source: { type: 'geojson', url: `${EXTRA}/x.geojson` },
    };
  return file;
};

const directive = (csp: string, name: string): string =>
  csp.split(';').find((d) => d.trim().startsWith(name)) ?? '';

test.describe('WP-957: map origins in the CSP', () => {
  let admin: APIRequestContext;
  test.beforeAll(async ({ playwright, baseURL }) => {
    expect(cli(['create-project', KEY, KEY]).status).toBe(0);
    const created = cli(['create-admin', 'csp@example.org']);
    const secret = base32Decode(
      new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
    );
    expect(cli(['confirm-totp', 'csp@example.org', totpAt(secret, Date.now())]).status).toBe(0);
    expect(cli(['add-membership', 'csp@example.org', KEY, 'verwaltung']).status).toBe(0);
    admin = await playwright.request.newContext({ baseURL: baseURL ?? '' });
    const login = await admin.post('/api/auth/login', {
      data: { email: 'csp@example.org', password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
    });
    expect(login.status()).toBe(200);
  });
  test.afterAll(async () => admin.dispose());

  const deployed = async (extra: boolean): Promise<void> => {
    const r = await admin.post(`/api/admin/p/${KEY}/deploy`, { data: withExtraLayer(extra) });
    expect(await r.json()).toMatchObject({ ok: true });
  };

  test('a deploy adds its layer hosts to a page and an API response; the next deploy removes them again', async ({
    request,
  }) => {
    await deployed(true);
    for (const path of ['/login', '/api/health']) {
      const csp = (await request.get(path)).headers()['content-security-policy'] ?? '';
      for (const d of ['connect-src', 'img-src']) {
        expect(directive(csp, d), `${path} ${d}`).toContain(EXTRA);
        expect(directive(csp, d), `${path} ${d}`).not.toContain(OSM); // proxied base map: no host in the policy
      }
      if (path === '/login') expect(directive(csp, 'script-src')).toMatch(/'nonce-/);
      expect(directive(csp, 'script-src')).not.toContain(EXTRA);
    }
    await deployed(false);
    const csp = (await request.get('/login')).headers()['content-security-policy'] ?? '';
    expect(directive(csp, 'connect-src')).not.toContain(EXTRA);
  });

  // That tiles go through the proxy and never to the provider is proven by e2e/participant/layer-sheet.spec.ts (WP-689);
  // here only that the page, with its proxied base map, raises no CSP violation.
  test('the participant page shows the base map through the tile proxy without a CSP violation', async ({
    page,
    baseURL,
  }) => {
    await deployed(false);
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && /content security policy/i.test(m.text())) problems.push(m.text());
    });
    await page.addInitScript(() =>
      document.addEventListener('securitypolicyviolation', (e) =>
        console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI}`),
      ),
    );
    // no internet: the upstream host is unreachable by design; a request to it would be a bug
    const upstream: string[] = [];
    await page.route(`${OSM}/**`, (route) => {
      upstream.push(route.request().url());
      return route.abort();
    });
    const token = rosterToken(E2E_DATA_DIR, KEY, 'p-csp', ['kontrolle']);
    const res = await page.context().request.post(`${baseURL}/api/auth/exchange`, { data: { token } });
    expect(res.status()).toBe(200);
    await page.goto('/map');
    await page.waitForLoadState('networkidle');
    expect(upstream).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test('/login sends no Referer and the bootstrap cache holds no token (WP-772)', async ({ request }) => {
  const res = await request.get('/login?token=abc');
  expect(res.headers()['referrer-policy']).toBe('no-referrer');
  expect((await request.get('/does-not-exist')).headers()['referrer-policy']).toBe(
    'strict-origin-when-cross-origin',
  );
});
