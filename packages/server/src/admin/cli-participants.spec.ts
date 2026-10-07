import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createAuth } from '../auth';
import { isAuthError } from '../auth/contract';
import { openControlDb, openProjectDb } from '../db/open';
import { participantRolesOf } from '../auth/participant-roles';
import { runCli } from './cli-run';

const dir = mkdtempSync(join(tmpdir(), 'ueb-cli-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function cli(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, { DATA_DIR: dir }, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out, err };
}

describe('admin CLI: participant', () => {
  it('adds, lists, issues a QR that exchanges with the roster roles, revokes and removes', async () => {
    await cli('create-project', 'demo', 'Demo');
    const added = await cli('participant', 'add', 'demo', 'Anna', 'kontrolle,bauhof');
    expect(added.code).toBe(0);
    const anna = /with id (\S+)\./.exec(added.out[0] ?? '')?.[1] ?? '';
    expect(anna).toMatch(/^anna-[0-9a-f]{6}$/);
    expect((await cli('participant', 'add', 'demo', ' ')).err).toEqual(['Refused: name_required']);
    const q = await cli('participant', 'qr', 'demo', anna);
    expect(q.code).toBe(0);
    const token = q.out[1] as string;
    expect(token).toMatch(/^\S{20,}$/);

    const listed = await cli('participant', 'list', 'demo');
    expect(listed.out).toEqual([`${anna}\tkontrolle,bauhof\tactive\t1 QR`]);
    expect(listed.out.join('\n')).not.toContain(token);

    // The token exchanges against the same databases; revoke ends it.
    const control = openControlDb(join(dir, 'control.db'));
    const db = openProjectDb(dir, 'demo');
    const auth = createAuth({
      control,
      now: () => new Date(),
      participantRoles: (_p, id) => participantRolesOf(db, id),
    });
    const s = auth.exchange(token);
    if (isAuthError(s)) throw new Error(s.code);
    expect(s.principal.roles).toEqual(['kontrolle', 'bauhof']);
    expect((await cli('participant', 'revoke', 'demo', anna)).code).toBe(0);
    expect(auth.authenticate(s.id)).toBeNull();

    expect((await cli('participant', 'roles', 'demo', anna, 'verwaltung')).code).toBe(0);
    expect((await cli('participant', 'disable', 'demo', anna)).code).toBe(0);
    expect((await cli('participant', 'qr', 'demo', anna)).err).toEqual(['Refused: participant_disabled']);
    expect((await cli('participant', 'list', 'demo')).out[0]).toContain('disabled');
    expect((await cli('participant', 'enable', 'demo', anna)).code).toBe(0);
    expect((await cli('participant', 'list', 'demo')).out[0]).toContain('active');
    expect((await cli('participant', 'remove', 'demo', anna)).code).toBe(0);
    expect((await cli('participant', 'list', 'demo')).out).toEqual([]);
    db.close();
    control.close();
  });

  it('refuses an unknown project and a missing argument', async () => {
    expect((await cli('participant', 'list', 'nope')).code).toBe(1);
    expect((await cli('participant', 'add', 'demo')).code).toBe(2);
  });
});
