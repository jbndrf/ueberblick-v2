import { mkdtempSync } from 'node:fs';
// Shared world of the blob HTTP specs (WP-604, WP-757): a project with auth, a byte store and the three blob handlers.
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Actor, Key, TemplateFile } from '@ueberblick/core';
import { createAuth, isAuthError, type Auth } from '../../auth';
import { fileBlobStore } from '../../blobs';
import { createThumbnails } from '../../blobs/thumbs';
import { openControlDb } from '../../db/open';
import { createConfigResolver, createVersionCache } from '../../store/run/config-for';
import { build, setup } from '../../store/run/testkit';
import type { BlobLimits } from '../shared';
import { createLogger } from '../../log';
import { createBlobHandlers } from './handlers';
export const dirs: string[] = [];

export const template = (): TemplateFile =>
  ({
    schema: 'ueberblick/1',
    template: { key: 'blob_http', version: '1.0.0' },
    roles: { melder: { label: 'Melder' }, sachbearbeiter: { label: 'Sachbearbeitung' } },
    types: {
      meldung: {
        label: 'Meldung',
        permissions: { see: { foto: ['sachbearbeiter'] }, create: '$all', write: '$all' },
        properties: { kategorie: { type: 'text' }, foto: { type: 'file' } },
      },
      intern: {
        label: 'Intern',
        permissions: { see: ['sachbearbeiter'], create: '$all', write: '$all' },
        properties: { anhang: { type: 'file' } },
      },
    },
    tasks: {
      melden: { label: 'Melden', on: '$none', creates: 'meldung', form: { kategorie: {}, foto: {} } },
      ablegen: { label: 'Ablegen', on: '$none', creates: 'intern', form: { anhang: {} } },
    },
  }) as unknown as TemplateFile;

export const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
export const file = (b: Buffer, name = 'a.jpg') => ({ sha256: sha(b), name, mime: 'image/jpeg' });
export const PHOTO = Buffer.from('photo bytes');
export const SECRET = Buffer.from('secret bytes');

export const logLines: string[] = [];

export async function world(limits?: Partial<BlobLimits>, icon?: string) {
  const root = mkdtempSync(join(tmpdir(), 'ub-blobhttp-'));
  dirs.push(root);
  const control = openControlDb(':memory:');
  for (const [id, key] of [
    ['p1', 'trees'],
    ['p2', 'other'],
  ] as const)
    control
      .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
      .run(id, key, key, 'x');
  const roles: Record<string, Key[]> = { mia: ['melder' as Key], sabine: ['sachbearbeiter' as Key] };
  const auth: Auth = createAuth({
    control,
    now: () => new Date('2026-05-01T08:00:00.000Z'),
    participantRoles: (_p, who) => roles[who] ?? ['melder' as Key],
  });
  const session = (projectId: string, who: string): string => {
    const s = auth.exchange(auth.issueCredential(projectId, who).token);
    if (isAuthError(s)) throw new Error(s.code);
    return `ub_session_participant=${s.id}`;
  };
  const adminId = await auth.createAdmin('a@example.org', 'correct horse battery');
  control
    .prepare('INSERT INTO memberships (account_id, project_id, role) VALUES (?,?,?)')
    .run(adminId, 'p1', 'verwaltung');
  const config = build(template());
  const ctx = setup({ config });
  const store = fileBlobStore(root);
  const handlers = createBlobHandlers({
    auth,
    project: (key) =>
      control.prepare<{ id: string; key: string }>('SELECT id, key FROM projects WHERE key = ?').get(key),
    clock: ctx.deps.clock,
    projectDb: () => ctx.db,
    store: () => store,
    deployed: () => ({
      version: 1,
      config: icon === undefined ? config : { ...config, file: { ...config.file, branding: { icon } } },
    }),
    versions: () =>
      createConfigResolver(
        ctx.db,
        createVersionCache((v) => (v === 1 ? config : undefined)),
      ),
    thumbs: () => createThumbnails(join(root, 'thumbs')),
    log: createLogger({ sink: (l) => logLines.push(l), now: () => 0 }),
    ...(limits ? { limits } : {}),
  });
  const cookies = {
    mia: session('p1', 'mia'),
    bernd: session('p1', 'bernd'),
    sabine: session('p1', 'sabine'),
    other: session('p2', 'zoe'),
    admin: `ub_session_admin=${auth.openAdminSession(adminId).id}`,
  };
  const call = (
    method: 'put' | 'head' | 'get',
    hash: string,
    o: {
      cookie?: string;
      body?: Buffer;
      project?: string;
      type?: string;
      headers?: Record<string, string>;
      thumb?: string;
    } = {},
  ) => {
    const query = o.thumb === undefined ? '' : `?thumb=${o.thumb}`;
    return handlers[method](
      new Request(`http://x/api/p/${o.project ?? 'trees'}/blobs/${hash}${query}`, {
        method: method.toUpperCase(),
        headers: {
          ...(o.cookie ? { cookie: o.cookie } : {}),
          ...(o.type ? { 'content-type': o.type } : {}),
          ...o.headers,
        },
        ...(o.body ? { body: o.body, duplex: 'half' } : {}),
      } as RequestInit),
      { params: { project: o.project ?? 'trees', sha: hash } },
    );
  };
  const actor = (id: string, role: string): Actor => ({ id, kind: 'participant', roles: [role as Key] });
  const runAs = (who: Actor, task: string, input: Record<string, unknown>) =>
    ctx.store.submit(ctx.run(task, who, input as never));
  return { handlers, ctx, cookies, call, root, store, actor, runAs };
}
