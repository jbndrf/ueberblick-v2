/**
 * The first admin from `.env` (WP-942): at server start, when control.db has no account yet and `ADMIN_EMAIL` and
 * `ADMIN_PASSWORD` are set, the account is created. Later starts never touch accounts. The password is never written.
 */
import { defineRegistry, type KeyOf } from '@ueberblick/core';
import type { Auth } from '../auth';
import type { Db } from '../db/driver';

export interface FirstAdminDeps {
  readonly control: Db;
  readonly auth: Pick<Auth, 'createAdmin'>;
  /** Where the one-line messages go (the operator's console). */
  readonly say: (line: string) => void;
}

/** What the start did about the first admin. */
export const FIRST_ADMIN_OUTCOMES = defineRegistry([
  { key: 'created', description: 'No account existed: the admin from .env was created.' },
  { key: 'exists', description: 'An account exists already: nothing was touched.' },
  { key: 'missing', description: 'No account and no ADMIN_EMAIL / ADMIN_PASSWORD: a hint was printed.' },
] as const);
export type FirstAdminOutcome = KeyOf<typeof FIRST_ADMIN_OUTCOMES>;

/** The hint when there is no admin and no variables. German first (the operators' language), then English. */
export const NO_ADMIN_HINT =
  'Kein Administrator vorhanden: setzen Sie ADMIN_EMAIL und ADMIN_PASSWORD in .env und starten Sie neu. ' +
  'No admin exists: set ADMIN_EMAIL and ADMIN_PASSWORD in .env and restart.';

export async function ensureFirstAdmin(
  deps: FirstAdminDeps,
  admin: { readonly email: string; readonly password: string } | null,
): Promise<FirstAdminOutcome> {
  const accounts = deps.control.prepare<{ n: number }>('SELECT COUNT(*) AS n FROM accounts').get()?.n ?? 0;
  if (accounts > 0) return 'exists';
  if (admin === null) {
    deps.say(NO_ADMIN_HINT);
    return 'missing';
  }
  await deps.auth.createAdmin(admin.email, admin.password);
  deps.say(`Admin angelegt: ${admin.email.trim().toLowerCase()}`);
  return 'created';
}
