/** Test helpers for the OGC API Features handlers: a project with two roles behind real sessions. */
import type { Key } from '@ueberblick/core';
import { createAuth, isAuthError, type Auth } from '../../auth';
import type { Db } from '../../db/driver';
import { openControlDb } from '../../db/open';
import { scopedConfig, syncSetup, type SyncCtx, type SyncVersionsSetup } from '../../sync/testkit';
import { golden, NOW, seedMusterstadt } from '../../store/run/testkit';
import type { CompiledConfig } from '@ueberblick/core';
import { createServerIds } from '../shared/ids';
import { createOgcHandlers, type OgcDeps, type OgcHandlers } from './handlers';

export interface OgcWorld {
  readonly ctx: SyncCtx;
  readonly handlers: OgcHandlers;
  /** The auth service behind the sessions: `auth.apiTokens.issue('p1', 'anna', …)` makes a QGIS token (A-037). */
  readonly auth: Auth;
  /** The control database and the id of the admin account behind `cookies.admin` (WP-1070). */
  readonly control: Db;
  readonly adminId: string;
  /** Cookie headers: `admin` is an admin with role verwaltung; `anna` a participant (kontrolle). */
  readonly cookies: { readonly admin: string; readonly anna: string; readonly stranger: string };
  get(path: string, cookie?: string): Promise<Response>;
  /** `cookie` is a Cookie header value; `extra` more headers (an `authorization` token, `content-crs`). */
  send(
    method: string,
    path: string,
    body?: unknown,
    cookie?: string,
    extra?: Record<string, string>,
  ): Promise<Response>;
}

export interface WorldOptions {
  /** `scoped`: baum rows are visible to their assignee and to `verwaltung` (sync/testkit); default: plain golden. */
  readonly scoped?: boolean;
  /** Roles of the participant `anna` (default kontrolle). */
  /** A compiled config to serve instead of the golden one (wins over `scoped`). */
  readonly config?: CompiledConfig;
  readonly annaRoles?: readonly Key[];
  /** More stored config versions and which one is deployed (A-029): `config` is version 1. */
  readonly versions?: SyncVersionsSetup;
  readonly deps?: Partial<OgcDeps>;
}

export async function ogcWorld(opts: WorldOptions = {}): Promise<OgcWorld> {
  const control = openControlDb(':memory:');
  control
    .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
    .run('p1', 'trees', 'trees', 'x');
  const auth: Auth = createAuth({
    control,
    now: () => new Date('2026-05-01T08:00:00.000Z'),
    participantRoles: () => [...(opts.annaRoles ?? ['kontrolle' as Key])],
  });
  const config: CompiledConfig =
    opts.config ?? (opts.scoped === true ? scopedConfig() : golden('musterstadt-plain'));
  const ctx = syncSetup(config, undefined, opts.versions);
  const deployedVersion = opts.versions?.deployed ?? 1;
  const atVersion = (v: number): CompiledConfig =>
    v === 1 ? config : (opts.versions?.configs.get(v) as CompiledConfig);
  seedMusterstadt(ctx);
  const session = (who: string): string => {
    const s = auth.exchange(auth.issueCredential('p1', who).token);
    if (isAuthError(s)) throw new Error(s.code);
    return s.id;
  };
  const adminId = await auth.createAdmin('a@example.org', 'correct horse battery');
  control
    .prepare('INSERT INTO memberships (account_id, project_id, role) VALUES (?,?,?)')
    .run(adminId, 'p1', 'verwaltung');
  const strangerId = await auth.createAdmin('b@example.org', 'correct horse battery');
  const clock = { now: () => NOW };
  const deps: OgcDeps = {
    auth,
    project: (key) =>
      control.prepare<{ id: string; key: string }>('SELECT id, key FROM projects WHERE key = ?').get(key),
    db: () => ctx.db,
    store: () => ctx.store,
    sync: () => ctx.service,
    deployed: () => ({ version: deployedVersion, config: atVersion(deployedVersion) }),
    clock,
    ids: createServerIds(clock),
    ...opts.deps,
  };
  const handlers = createOgcHandlers(deps);
  const cookies = {
    admin: `ub_session_admin=${auth.openAdminSession(adminId).id}`,
    anna: `ub_session_participant=${session('anna')}`,
    stranger: `ub_session_admin=${auth.openAdminSession(strangerId).id}`,
  };
  const send: OgcWorld['send'] = (method, path, body, cookie = cookies.admin, extra = {}) => {
    const [pathname = '', query] = path.split('?');
    const rest = pathname.replace(/^\//, '');
    const url = `http://x/api/p/trees/ogc${rest === '' ? '' : `/${rest}`}${query === undefined ? '' : `?${query}`}`;
    return handlers.handle(
      new Request(url, {
        method,
        headers: {
          ...(cookie ? { cookie } : {}),
          ...extra,
          ...(body === undefined ? {} : { 'content-type': 'application/geo+json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { params: { project: 'trees', path: rest } },
    );
  };
  return {
    ctx,
    handlers,
    auth,
    control,
    adminId,
    cookies,
    get: (p, c) => send('GET', p, undefined, c),
    send,
  };
}
