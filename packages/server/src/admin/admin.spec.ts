import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { TemplateFile } from '@ueberblick/core';
import { createAuth } from '../auth';
import { base32Decode, totpAt } from '../auth/totp';
import { openControlDb } from '../db/open';
import {
  addMembership,
  confirmAdminTotp,
  createAdmin,
  createProject,
  publishTemplateFile,
} from './bootstrap';
import { embedGoldenRefs } from '@ueberblick/core/testing';

const golden = embedGoldenRefs(
  parse(
    readFileSync(
      fileURLToPath(
        new URL('../../../../fixtures/golden/templates/baumkataster/1.0.0.yaml', import.meta.url),
      ),
      'utf8',
    ),
  ),
) as TemplateFile;

function setup() {
  const control = openControlDb(':memory:');
  let t = Date.UTC(2026, 0, 1);
  const now = () => new Date(t);
  const auth = createAuth({ control, now, participantRoles: () => [] });
  const clock = { now: () => now().toISOString() };
  return { control, auth, clock, advance: (ms: number) => (t += ms), now };
}
const PASSWORD = 'correct horse battery';
const secretOf = (uri: string): Uint8Array => base32Decode(new URL(uri).searchParams.get('secret') ?? '');

describe('bootstrap', () => {
  it('creates a project; a duplicate or invalid key is refused', () => {
    const { control, clock } = setup();
    const p = createProject(control, { key: 'musterstadt', name: 'Musterstadt' }, clock);
    expect(p.key).toBe('musterstadt');
    expect(() => createProject(control, { key: 'musterstadt', name: 'x' }, clock)).toThrow();
    expect(() => createProject(control, { key: 'Bad Key', name: 'x' }, clock)).toThrow();
  });

  it('createAdmin returns the enrolment URI; a wrong first code does not log in', async () => {
    const { control, auth } = setup();
    const r = await createAdmin(auth, 'Admin@Example.org', PASSWORD);
    expect(r.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(await auth.loginAdmin('admin@example.org', PASSWORD, '123456')).toEqual({ code: 'invalid_login' });
    expect(control.prepare('SELECT count(*) AS n FROM accounts').get()).toEqual({ n: 1 });
  });

  it('confirmAdminTotp with the right code enables login; a wrong code does not', async () => {
    const { control, auth, now, advance } = setup();
    const r = await createAdmin(auth, 'admin@example.org', PASSWORD);
    const key = secretOf(r.otpauthUri);
    expect(confirmAdminTotp(control, auth, 'admin@example.org', '000000')).toBe(false);
    expect(confirmAdminTotp(control, auth, 'admin@example.org', totpAt(key, now().getTime()))).toBe(true);
    advance(30_000);
    const s = await auth.loginAdmin('admin@example.org', PASSWORD, totpAt(key, now().getTime()));
    expect('principal' in s).toBe(true);
  });

  it('addMembership links an account to a project by email and key; unknowns throw', async () => {
    const { control, auth, clock } = setup();
    const p = createProject(control, { key: 'musterstadt', name: 'M' }, clock);
    const a = await createAdmin(auth, 'admin@example.org', PASSWORD);
    addMembership(control, { email: 'ADMIN@example.org', projectKey: 'musterstadt', role: 'verwaltung' });
    expect(auth.rolesFor(a.accountId, p.id)).toEqual(['verwaltung']);
    expect(() =>
      addMembership(control, { email: 'nobody@example.org', projectKey: 'musterstadt', role: 'x' }),
    ).toThrow();
    expect(() =>
      addMembership(control, { email: 'admin@example.org', projectKey: 'nowhere', role: 'x' }),
    ).toThrow();
  });

  it('publishTemplateFile publishes a golden template and refuses non-templates', () => {
    const { control, clock } = setup();
    expect(publishTemplateFile(control, golden, clock)).toEqual({ ok: true, created: true });
    expect(publishTemplateFile(control, golden, clock)).toEqual({ ok: true, created: false });
    expect(publishTemplateFile(control, { hello: 'world' }, clock).ok).toBe(false);
  });
});
