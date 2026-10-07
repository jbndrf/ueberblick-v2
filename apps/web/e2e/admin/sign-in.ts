import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { E2E_DATA_DIR } from '../../playwright.config';

/**
 * Shared admin sign-in for the admin specs. The e2e server runs with the admin one-time code off
 * (`ADMIN_TOTP` is off by default since WP-942), so an account needs only e-mail and password.
 * A spec that needs the code starts its own server with `ADMIN_TOTP=on`.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const PASSWORD = 'correct horse battery';

/** Runs the `admin` CLI against the e2e data directory. */
export function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout };
}

/**
 * An e-mail no other spec or earlier round of this run has used: all specs of a run share one data directory, and
 * `create-admin` refuses an existing e-mail.
 */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.org`;
}

/** Creates an admin account with {@link PASSWORD}. */
export function createAdmin(email: string): void {
  expect(admin(['create-admin', email]).status).toBe(0);
}

/** Signs in at /admin/login with e-mail and password. */
export async function signInAs(page: Page, email: string): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
}
