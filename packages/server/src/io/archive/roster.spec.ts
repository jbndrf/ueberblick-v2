// A-046: the project ZIP carries the roster with the login tokens; the import restores them (WP-432).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { isAuthError } from '../../auth/contract';
import { setColumns } from '../../http/participants/columns';
import { importParticipant, disableParticipant, removeParticipant } from '../../http/participants/roster';
import { setCredential } from '../../http/participants/service';
import { openProjectDb } from '../../db/open';
import { world } from '../../http/participants/testkit';
import { setup } from '../../store/run/testkit';
import { exportArchive, type ArchiveSource } from './export-zip';
import { importArchive, type ArchiveImportDeps } from './import-zip';
import { ARCHIVE_ENTRIES, ARCHIVE_ZIP_LIMITS } from './manifest';
import { openZip, zipStream } from './zip';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const TOKEN_ANNA = 'ANNA-TOKEN-0001';
const TOKEN_BEN = 'BEN-TOKEN-00002';

/** A source project with a roster: columns, an active, a disabled, a removed and a token-less participant. */
function sourceRoster() {
  const w = world();
  const cols = setColumns(w.db, [
    { key: 'team', label: 'Team', type: 'text', required: false },
    { key: 'since', label: 'Seit', type: 'date', default: '2026-01-01' },
  ]);
  if (!cols.ok) throw new Error('columns');
  const add = (id: string, input: Record<string, unknown>) => {
    const r = importParticipant(w.ctx, { id, roles: ['kontrolle'], ...input } as never);
    if (!r.ok) throw new Error(r.code);
  };
  add('anna', { name: 'Anna', email: 'anna@example.org', phone: '0123', attrs: { team: 'Nord' } });
  add('ben', { name: 'Ben', roles: ['kontrolle', 'admin'] });
  add('gast', { name: 'Gast', selfJoined: true });
  add('cleo', { name: 'Cleo' });
  add('dora', { name: 'Dora' });
  const set = (id: string, token: string, expiresAt?: string) => {
    const r = setCredential(w.ctx, id, { token, ...(expiresAt ? { expiresAt } : {}) });
    if (!r.ok) throw new Error(r.code);
  };
  set('anna', TOKEN_ANNA);
  set('ben', TOKEN_BEN, '2099-01-01T00:00:00.000Z');
  disableParticipant(w.ctx, 'ben');
  set('cleo', 'CLEO-TOKEN-0003');
  removeParticipant(w.ctx, 'cleo');
  return w;
}

async function archiveOf(w: ReturnType<typeof sourceRoster>, roster: boolean): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'roster-spec-'));
  dirs.push(dir);
  const src: ArchiveSource = {
    db: w.db,
    project: { key: 'demo', name: 'Demo', description: '' },
    fileText: stringify(setup().config.file),
    deployed: false,
    blobs: { get: () => undefined },
    now: () => '2026-10-03T10:00:00.000Z',
    ...(roster ? { roster: { credential: (id) => w.auth.currentCredential('id-demo', id) } } : {}),
  };
  const parts: Buffer[] = [];
  for await (const c of exportArchive(src)) parts.push(Buffer.from(c));
  const path = join(dir, 'p.zip');
  writeFileSync(path, Buffer.concat(parts));
  return path;
}

/** The target: a fresh instance (its own control and project database) that now creates the project `neu`. */
function target() {
  const t = world();
  const removed: string[] = [];
  const deps: ArchiveImportDeps = {
    createProject: (text) => ({ ok: true, key: 'neu', fileText: text }),
    putLive: () => ({ ok: true, version: 1 }),
    removeProject: (key) => void removed.push(key),
    usedTokens: (tokens) => t.auth.tokensInUse(tokens),
    rosterTarget: () => ({ db: t.db, auth: t.auth, projectId: t.ctx.projectId, now: t.ctx.now }),
    store: () => setup().store,
    blobs: () => {
      throw new Error('no blobs');
    },
    ids: setup().deps.ids,
  };
  return { t, deps, removed };
}

describe('roster in the project ZIP', () => {
  it('export -> import into a fresh instance: participants, roles, columns and the existing token', async () => {
    const path = await archiveOf(sourceRoster(), true);
    const { t, deps } = target();
    expect((await importArchive(deps, path)).ok).toBe(true);
    const rows = t.db
      .prepare<Record<string, unknown>>(
        'SELECT id, name, roles, attrs, self_joined, hidden, disabled_at FROM participants ORDER BY id',
      )
      .all();
    expect(rows.map((r) => r['id'])).toEqual(['anna', 'ben', 'cleo', 'dora', 'gast']);
    expect(rows[0]).toMatchObject({
      name: 'Anna',
      roles: '["kontrolle"]',
      attrs: '{"team":"Nord","since":"2026-01-01","email":"anna@example.org","phone":"0123"}',
    });
    expect(JSON.parse(String(rows[1]?.['roles']))).toEqual(['kontrolle', 'admin']);
    expect(rows[1]?.['disabled_at']).not.toBeNull();
    expect(rows[2]).toMatchObject({ hidden: 1 });
    expect(rows[4]).toMatchObject({ self_joined: 1 });
    expect(
      t.db.prepare<{ key: string }>('SELECT key FROM participant_columns ORDER BY position').all(),
    ).toEqual([{ key: 'team' }, { key: 'since' }]);
    // the old token signs in on the new instance, as the same person
    const s = t.auth.exchange(TOKEN_ANNA);
    if (isAuthError(s)) throw new Error(s.code);
    expect(t.auth.toActor(s.principal)).toEqual({ id: 'anna', kind: 'participant', roles: ['kontrolle'] });
    // the expiry came with the token; a disabled participant's token stays refused until enabled
    expect(t.auth.currentCredential('id-demo', 'ben')).toMatchObject({
      token: TOKEN_BEN,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    expect(t.auth.exchange(TOKEN_BEN)).toEqual({ code: 'participant_disabled' });
    // a removed participant's revoked token is not in the archive, so it does not work
    expect(t.auth.exchange('CLEO-TOKEN-0003')).toEqual({ code: 'credential_unknown' });
  });

  it('the manifest names the roster and the entries are there (version 2)', async () => {
    const zip = await openZip(await archiveOf(sourceRoster(), true), ARCHIVE_ZIP_LIMITS);
    const manifest = JSON.parse(await zip.text(ARCHIVE_ENTRIES.manifest)) as Record<string, unknown>;
    expect(manifest).toMatchObject({ version: 2, roster: { participants: 5, columns: 2 } });
    expect(zip.has(ARCHIVE_ENTRIES.rosterColumns)).toBe(true);
    expect(zip.has(ARCHIVE_ENTRIES.rosterParticipants)).toBe(true);
  });

  it('a token already used on the target instance: the participant gets a new token, the others keep theirs, the count is reported', async () => {
    const path = await archiveOf(sourceRoster(), true);
    const { t, deps } = target();
    importParticipant(t.ctx, { id: 'other', name: 'Other', roles: [] });
    // the same token as Ben's, held by somebody else on this instance
    expect(setCredential(t.ctx, 'other', { token: TOKEN_BEN }).ok).toBe(true);
    const r = await importArchive(deps, path);
    expect(r).toMatchObject({ ok: true, renewedTokens: 1 });
    // Ben got a fresh token (and kept the expiry); Anna kept hers; the holder of the old token is unaffected
    const ben = t.auth.currentCredential('id-demo', 'ben');
    expect(ben?.token).not.toBe(TOKEN_BEN);
    expect(ben?.expiresAt).toBe('2099-01-01T00:00:00.000Z');
    expect(t.auth.currentCredential('id-demo', 'anna')?.token).toBe(TOKEN_ANNA);
    expect(t.auth.currentCredential('id-demo', 'other')?.token).toBe(TOKEN_BEN);
  });

  it('a copy on the same instance: every participant gets a new token and the original logins still work', async () => {
    const w = sourceRoster();
    const path = await archiveOf(w, true);
    w.control
      .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
      .run('id-copy', 'copy', 'Copy', w.ctx.now().toISOString());
    const copyDb = openProjectDb(':memory:', 'copy');
    const deps: ArchiveImportDeps = {
      ...target().deps,
      usedTokens: (tokens) => w.auth.tokensInUse(tokens),
      rosterTarget: () => ({ db: copyDb, auth: w.auth, projectId: 'id-copy', now: w.ctx.now }),
    };
    const r = await importArchive(deps, path);
    // anna, ben and dora... only the two with a live token are renewed (cleo was removed: no token in the file)
    expect(r).toMatchObject({ ok: true, renewedTokens: 2 });
    for (const id of ['anna', 'ben']) {
      const mine = w.auth.currentCredential('id-copy', id)?.token;
      expect(mine).toBeDefined();
      expect(mine).not.toBe(w.auth.currentCredential('id-demo', id)?.token);
    }
    // the original's login is untouched
    expect(w.auth.currentCredential('id-demo', 'anna')?.token).toBe(TOKEN_ANNA);
    const s = w.auth.exchange(TOKEN_ANNA);
    if (isAuthError(s)) throw new Error(s.code);
    expect(s.principal.projectId).toBe('id-demo');
  });

  it('a token used twice inside the archive is refused as well', async () => {
    const w = sourceRoster();
    // anna and dora with one token: possible only by hand-editing the file, so edit the exported line
    const path = await archiveOf(w, true);
    const zip = await openZip(path, ARCHIVE_ZIP_LIMITS);
    const edited =
      (await zip.text(ARCHIVE_ENTRIES.manifest)) &&
      (async () => {
        const chunks: Buffer[] = [];
        for await (const c of zip.open(ARCHIVE_ENTRIES.rosterParticipants)) chunks.push(Buffer.from(c));
        return Buffer.concat(chunks).toString('utf8').replaceAll('BEN-TOKEN-00002', TOKEN_ANNA);
      })();
    const dir = mkdtempSync(join(tmpdir(), 'roster-spec-'));
    dirs.push(dir);
    const entries = async function* () {
      for (const name of [ARCHIVE_ENTRIES.manifest, ARCHIVE_ENTRIES.file, ARCHIVE_ENTRIES.rosterColumns]) {
        const text = await zip.text(name);
        yield {
          name,
          data: (async function* () {
            yield Buffer.from(text);
          })(),
        };
      }
      const body = await edited;
      yield {
        name: ARCHIVE_ENTRIES.rosterParticipants,
        data: (async function* () {
          yield Buffer.from(body);
        })(),
      };
    };
    const parts: Buffer[] = [];
    for await (const c of zipStream(entries())) parts.push(Buffer.from(c));
    const bad = join(dir, 'dup.zip');
    writeFileSync(bad, Buffer.concat(parts));
    const { t, deps } = target();
    const r = await importArchive(deps, bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]?.code).toBe('token_duplicate');
    expect(t.db.prepare<{ n: number }>('SELECT count(*) AS n FROM participants').get()?.n).toBe(0);
  });

  it('an archive without a roster imports as before and creates no participants', async () => {
    const path = await archiveOf(sourceRoster(), false);
    const zip = await openZip(path, ARCHIVE_ZIP_LIMITS);
    expect(zip.has(ARCHIVE_ENTRIES.rosterParticipants)).toBe(false);
    const { t, deps } = target();
    expect((await importArchive(deps, path)).ok).toBe(true);
    expect(t.db.prepare<{ n: number }>('SELECT count(*) AS n FROM participants').get()?.n).toBe(0);
  });

  it('a failure after the roster was written removes the project (and with it the roster, the project delete path)', async () => {
    const path = await archiveOf(sourceRoster(), true);
    const { deps, removed } = target();
    const r = await importArchive(
      {
        ...deps,
        rosterTarget: () => {
          throw new Error('boom');
        },
      },
      path,
    ).catch((e: unknown) => e);
    expect(r).toBeInstanceOf(Error);
    expect(removed).toEqual(['neu']);
  });
});
