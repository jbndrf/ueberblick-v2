import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { base32Decode, totpAt } from '@ueberblick/server';
import { parse } from 'yaml';
import { E2E_DATA_DIR } from '../playwright.config';
import { goldenFile } from './golden';

/** WP-110: OGC API Features over the real built process, as an admin. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TEMPLATE = goldenFile('templates/baumkataster/1.0.0.yaml');
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

let ctx: APIRequestContext;

test.beforeAll(async ({ playwright, baseURL }) => {
  expect(admin(['create-project', 'ogcstadt', 'ogcstadt']).status).toBe(0);
  const created = admin(['create-admin', 'ogc@example.org']);
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', 'ogc@example.org', totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', 'ogc@example.org', 'ogcstadt', 'verwaltung']).status).toBe(0);
  expect(admin(['publish-template', TEMPLATE]).status).toBe(0);
  ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await ctx.post('/api/auth/login', {
    data: { email: 'ogc@example.org', password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post('/api/admin/p/ogcstadt/deploy', {
    data: parse(readFileSync(TEMPLATE, 'utf8')),
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
});
test.afterAll(async () => ctx.dispose());

test('anonymous is 401', async ({ request }) => {
  expect((await request.get('/api/p/ogcstadt/ogc')).status()).toBe(401);
});

test('an admin reads the landing page, conformance and collections', async () => {
  const landing = await ctx.get('/api/p/ogcstadt/ogc');
  expect(landing.status()).toBe(200);
  const links = (await landing.json()).links as { rel: string; href: string }[];
  expect(links.map((l) => l.rel)).toEqual(expect.arrayContaining(['self', 'conformance', 'data']));
  const conformance = await ctx.get('/api/p/ogcstadt/ogc/conformance');
  expect((await conformance.json()).conformsTo).toContain(
    'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core',
  );
  const collections = await ctx.get('/api/p/ogcstadt/ogc/collections');
  const ids = ((await collections.json()).collections as { id: string }[]).map((c) => c.id);
  expect(ids).toContain('baum');
});

test('a create is a run: 201 with a Location, then the item is readable', async () => {
  const made = await ctx.post('/api/p/ogcstadt/ogc/collections/baumart/items', {
    data: { type: 'Feature', geometry: null, properties: { name_de: 'Ahorn' } },
  });
  expect(made.status()).toBe(201);
  const item = await ctx.get(new URL(made.headers()['location'] ?? '').pathname);
  expect(item.status()).toBe(200);
  expect((await item.json()).properties.name_de).toBe('Ahorn');
  expect((await ctx.get('/api/p/ogcstadt/ogc/collections/baum/items?bbox=1,2,3')).status()).toBe(400);
});
