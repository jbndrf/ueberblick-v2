import { expect, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import { base32Decode, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR } from '../../../playwright.config';
import { rosterToken } from '../../seed';
import { admin, PASSWORD, STEP_MS } from './verify-world';

/**
 * WP-857: a project with the chat on and no message in it. It is deployed from the template `step5@1`, which the
 * step-5 world publishes (so the caller depends on its `world` fixture), under its own key and its own admin.
 */
export const EMPTY_CHAT_KEY = 'step5leer';
const EMAIL = 'step5leer@example.org';

/** Creates the project (once) and deploys `step5@1` to it. */
export async function seedEmptyChat(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string,
): Promise<void> {
  if (admin(['create-project', EMPTY_CHAT_KEY, EMPTY_CHAT_KEY]).status !== 0) return; // a restarted worker finds it
  const created = admin(['create-admin', EMAIL]);
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', EMAIL, totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', EMAIL, EMPTY_CHAT_KEY, 'verwaltung']).status).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL });
  const login = await ctx.post('/api/auth/login', {
    data: { email: EMAIL, password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${EMPTY_CHAT_KEY}/deploy`, {
    data: { schema: 'ueberblick/1', extends: 'step5@1' },
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
}

/** Signs in as a field participant of the empty-chat project and waits for the map. */
export async function signInEmptyChat(page: Page, participant: string): Promise<void> {
  const token = rosterToken(E2E_DATA_DIR, EMPTY_CHAT_KEY, participant, ['kontrolle']);
  await page.goto(`/login?token=${encodeURIComponent(token)}`);
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
}
