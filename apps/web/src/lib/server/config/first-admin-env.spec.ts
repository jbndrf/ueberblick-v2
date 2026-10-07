import { describe, expect, it } from 'vitest';
import { createAuth, ensureFirstAdmin, openControlDb } from '@ueberblick/server';
import { loadConfig } from './parse';

// WP-492 (verify step 1): the operator's .env variables go through the real config parser into the real start step.
const ENV = {
  PUBLIC_URL: 'https://x.example.org',
  ADMIN_EMAIL: 'Chef@Example.org',
  ADMIN_PASSWORD: 'correct horse battery',
};

function start() {
  const control = openControlDb(':memory:');
  const auth = createAuth({ control, now: () => new Date(), participantRoles: () => [] });
  const lines: string[] = [];
  const boot = (env: Record<string, string>) =>
    ensureFirstAdmin({ control, auth, say: (l) => lines.push(l) }, loadConfig(env).admin);
  const emails = (): string[] =>
    control
      .prepare<{ email: string }>('SELECT email FROM accounts')
      .all()
      .map((r) => r.email);
  return { auth, lines, boot, emails, control };
}

describe('first admin from ADMIN_EMAIL and ADMIN_PASSWORD', () => {
  it('the first start creates the admin, who signs in with that password', async () => {
    const t = start();
    expect(await t.boot(ENV)).toBe('created');
    expect(t.emails()).toEqual(['chef@example.org']);
    const id = t.control.prepare<{ id: string }>('SELECT id FROM accounts').get()?.id ?? '';
    expect(await t.auth.verifyPassword(id, ENV.ADMIN_PASSWORD)).toBe(true);
    expect(t.lines.join('\n')).not.toContain(ENV.ADMIN_PASSWORD);
  });

  it('a later start with other variables creates nothing and changes nothing', async () => {
    const t = start();
    await t.boot(ENV);
    const id = t.control.prepare<{ id: string }>('SELECT id FROM accounts').get()?.id ?? '';
    expect(
      await t.boot({ ...ENV, ADMIN_EMAIL: 'other@example.org', ADMIN_PASSWORD: 'another long password' }),
    ).toBe('exists');
    expect(t.emails()).toEqual(['chef@example.org']);
    expect(await t.auth.verifyPassword(id, ENV.ADMIN_PASSWORD)).toBe(true);
  });
});
