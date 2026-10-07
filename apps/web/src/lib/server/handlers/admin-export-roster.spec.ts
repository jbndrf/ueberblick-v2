import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { isAuthError, type Principal } from '@ueberblick/server';
import { golden } from '../../../../../../packages/server/src/store/run/testkit';
import { openZip, zipStream } from '../../../../../../packages/server/src/io/archive/zip';
import { ARCHIVE_ZIP_LIMITS } from '../../../../../../packages/server/src/io/archive/manifest';
import type { Call } from './http';
import type * as Export from './admin-export';
import type * as Runtime from '../runtime';

// The REAL export and import over the real runtime (WP-432, A-046): the project ZIP carries the roster with the login
// tokens, an import restores them so the same token signs in, and a token already in use refuses the import.
const dir = mkdtempSync(join(tmpdir(), 'ub-zip-roster-'));
let handlers: (typeof Export)['adminExportHandlers'];
let rt: ReturnType<(typeof Runtime)['runtime']>;
let admin: Principal;
// unique per execution: the runtime is shared by repeats, and a token that is already live would take the collision path
let TOKEN = '';
const projectCount = (): number =>
  rt.control.prepare<{ n: number }>('SELECT count(*) AS n FROM projects').get()?.n ?? 0;

beforeAll(async () => {
  process.env['PUBLIC_URL'] = 'http://localhost:3000';
  process.env['DATA_DIR'] = dir;
  process.env['TIMERS_INTERVAL_S'] = '0';
  rt = (await import('../runtime')).runtime();
  handlers = (await import('./admin-export')).adminExportHandlers;
  const id = await rt.auth.createAdmin('a@example.org', 'correct horse battery');
  admin = { kind: 'admin', id, projectId: null, roles: [] };
});
afterAll(() => {
  rt.stop();
  rmSync(dir, { recursive: true, force: true });
});

const text = (s: string): AsyncGenerator<Uint8Array> =>
  (async function* () {
    yield Buffer.from(s);
  })();

async function rosterZip(twice = false): Promise<Buffer> {
  const manifest = {
    format: 'ueberblick-project-zip',
    version: 2,
    exportedAt: 'x',
    project: { key: 'a', name: 'Roster', description: '' },
    deployed: false,
    types: {},
    blobs: { count: 0, bytes: 0 },
    roster: { participants: twice ? 2 : 1, columns: 1 },
  };
  const anna = {
    id: 'anna',
    name: 'Anna',
    email: 'anna@example.org',
    phone: null,
    roles: ['kontrolle'],
    attrs: { team: 'Nord' },
    selfJoined: false,
    createdAt: null,
    disabledAt: null,
    hidden: false,
    login: { token: TOKEN, expiresAt: null },
  };
  const parts: Buffer[] = [];
  for await (const c of zipStream([
    { name: 'manifest.json', data: text(JSON.stringify(manifest)) },
    { name: 'project.yaml', data: text(stringify(golden('musterstadt-plain').file)) },
    {
      name: 'roster/columns.json',
      data: text(JSON.stringify([{ key: 'team', label: 'Team', type: 'text' }])),
    },
    {
      name: 'roster/participants.ndjson',
      data: text(`${JSON.stringify(anna)}\n${twice ? `${JSON.stringify({ ...anna, id: 'ben' })}\n` : ''}`),
    },
  ]))
    parts.push(Buffer.from(c));
  return Buffer.concat(parts);
}

const call = (params: Record<string, string>, body?: Buffer): Call =>
  ({
    locals: { admin },
    params,
    request: new Request('http://localhost:3000/x', {
      method: body ? 'POST' : 'GET',
      ...(body ? { body: new Blob([new Uint8Array(body)]) } : {}),
    }),
    getClientAddress: () => '127.0.0.1',
  }) as unknown as Call;

type Job = { state: string; key?: string; problems?: { code?: string; message: string }[] };
async function importZip(zip: Buffer): Promise<Job> {
  const started = await handlers.importZip(call({}, zip));
  const { job } = (await started.json()) as { job: string };
  let state: Job = { state: 'queued' };
  for (let i = 0; i < 400 && state.state !== 'failed' && state.state !== 'done'; i++) {
    await new Promise((r) => setTimeout(r, 25));
    state = ((await handlers.importZipStatus(call({ job })).json()) as { job: Job }).job;
  }
  return state;
}

describe('the roster in the project ZIP, over the real runtime', () => {
  it('imports the roster with its token, exports it again, gives a colliding token a new one, refuses a token twice in one archive', async () => {
    TOKEN = `ROSTER-${randomUUID()}`;
    const projectsBefore = projectCount();
    const zip = await rosterZip();
    const first = await importZip(zip);
    expect(first.state).toBe('done');
    const key = first.key ?? '';
    // the token of the archive signs in on this instance, as the participant of the archive
    const s = rt.auth.exchange(TOKEN);
    if (isAuthError(s)) throw new Error(s.code);
    expect(rt.auth.toActor(s.principal)).toMatchObject({ id: 'anna', roles: ['kontrolle'] });

    // the export of that project carries the roster and the token again
    const res = handlers.zip(call({ project: key }));
    expect(res.status).toBe(200);
    const path = join(dir, 'out.zip');
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    const out = await openZip(path, ARCHIVE_ZIP_LIMITS);
    expect(JSON.parse(await out.text('manifest.json'))).toMatchObject({
      version: 2,
      roster: { participants: 1 },
    });
    expect(await out.text('roster/participants.ndjson')).toContain(TOKEN);

    // a copy on the same instance: the colliding token is replaced, the original login keeps working
    const again = await importZip(zip);
    expect(again).toMatchObject({ state: 'done', renewedTokens: 1 });
    expect(projectCount()).toBe(projectsBefore + 2);
    const original = rt.auth.exchange(TOKEN);
    if (isAuthError(original)) throw new Error(original.code);
    expect(original.principal.projectId).toBe(rt.project(key)?.id);
    const copyKey = again.key ?? '';
    const fresh = rt.auth.currentCredential(rt.project(copyKey)?.id ?? '', 'anna');
    expect(fresh?.token).toBeDefined();
    expect(fresh?.token).not.toBe(TOKEN);

    // an archive that repeats a token inside itself is corrupt and refused
    const dup = await importZip(await rosterZip(true));
    expect(dup.state).toBe('failed');
    expect(dup.problems?.[0]?.code).toBe('token_duplicate');
    expect(projectCount()).toBe(projectsBefore + 2);
  });
});
