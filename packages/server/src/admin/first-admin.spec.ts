import { describe, expect, it } from 'vitest';
import { createAuth } from '../auth';
import { openControlDb } from '../db/open';
import { ensureFirstAdmin } from './first-admin';

const ADMIN = { email: 'Chef@Example.org', password: 'correct horse battery' } as const;

function setup() {
  const control = openControlDb(':memory:');
  const auth = createAuth({ control, now: () => new Date(), participantRoles: () => [] });
  const lines: string[] = [];
  const run = (admin: { email: string; password: string } | null) =>
    ensureFirstAdmin({ control, auth, say: (l) => lines.push(l) }, admin);
  const count = (): number =>
    control.prepare<{ n: number }>('SELECT COUNT(*) AS n FROM accounts').get()?.n ?? -1;
  return { control, auth, lines, run, count };
}

describe('first admin from .env', () => {
  it('creates exactly one admin on first start, says so, and never logs the password', async () => {
    const t = setup();
    expect(await t.run(ADMIN)).toBe('created');
    expect(t.count()).toBe(1);
    expect(t.lines).toEqual(['Admin angelegt: chef@example.org']);
    expect(t.lines.join('\n')).not.toContain(ADMIN.password);
    expect(await t.auth.verifyPassword(accountId(t.control), ADMIN.password)).toBe(true);
  });

  it('a second start creates nothing and ignores changed variables', async () => {
    const t = setup();
    await t.run(ADMIN);
    t.lines.length = 0;
    expect(await t.run({ email: 'other@example.org', password: 'another long password' })).toBe('exists');
    expect(t.count()).toBe(1);
    expect(t.lines).toEqual([]);
  });

  it('without the variables and without an admin it prints one hint and does not throw', async () => {
    const t = setup();
    expect(await t.run(null)).toBe('missing');
    expect(t.count()).toBe(0);
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0]).toContain('ADMIN_EMAIL');
    expect(t.lines[0]).toContain('ADMIN_PASSWORD');
  });

  it('with an admin present and no variables it stays silent', async () => {
    const t = setup();
    await t.run(ADMIN);
    t.lines.length = 0;
    expect(await t.run(null)).toBe('exists');
    expect(t.lines).toEqual([]);
  });
});

function accountId(control: ReturnType<typeof openControlDb>): string {
  return control.prepare<{ id: string }>('SELECT id FROM accounts').get()?.id ?? '';
}
