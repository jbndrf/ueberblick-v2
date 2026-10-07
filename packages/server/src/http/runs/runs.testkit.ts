import { SESSION_PARTICIPANT_HEADER, type Key } from '@ueberblick/core';
import { createAuth, isAuthError, type Auth } from '../../auth';
import { openControlDb } from '../../db/open';
import type { Store } from '../../store';
import { logSpy } from '../../store/run/log.testkit';
import { setup as storeSetup } from '../../store/run/testkit';
import type { HttpLimits } from '../shared';
import { createRunHandlers } from './handlers';

/** A control.db with two projects, a participant of `trees`, an admin of `trees` and an admin of nothing. */
/** `wrap` puts a double between the handlers and the real store (a store that throws). */
export async function world(limits?: Partial<HttpLimits>, wrap?: (real: Store) => Store) {
  const control = openControlDb(':memory:');
  for (const [id, key] of [
    ['p1', 'trees'],
    ['p2', 'other'],
  ] as const)
    control
      .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
      .run(id, key, key, 'x');
  const auth: Auth = createAuth({
    control,
    now: () => new Date('2026-05-01T08:00:00.000Z'),
    participantRoles: () => ['kontrolle' as Key],
  });
  const session = (projectId: string, who: string): string => {
    const s = auth.exchange(auth.issueCredential(projectId, who).token);
    if (isAuthError(s)) throw new Error(s.code);
    return s.id;
  };
  const adminId = await auth.createAdmin('a@example.org', 'correct horse battery');
  control
    .prepare('INSERT INTO memberships (account_id, project_id, role) VALUES (?,?,?)')
    .run(adminId, 'p1', 'verwaltung');
  const strangerId = await auth.createAdmin('b@example.org', 'correct horse battery');
  const ctx = storeSetup();
  const logs = logSpy();
  const store = wrap ? wrap(ctx.store) : ctx.store;
  const handlers = createRunHandlers({
    log: logs.log,
    auth,
    project: (key) =>
      control.prepare<{ id: string; key: string }>('SELECT id, key FROM projects WHERE key = ?').get(key),
    store: () => store,
    ...(limits ? { limits } : {}),
  });
  const cookies = {
    anna: `ub_session_participant=${session('p1', 'anna')}`,
    annaOther: `ub_session_participant=${session('p2', 'anna2')}`,
    admin: `ub_session_admin=${auth.openAdminSession(adminId).id}`,
    stranger: `ub_session_admin=${auth.openAdminSession(strangerId).id}`,
  };
  const call = (
    which: 'submit' | 'batch',
    body: unknown,
    opts: {
      cookie?: string;
      project?: string;
      raw?: string | ReadableStream<Uint8Array>;
      as?: string;
    } = {},
  ) =>
    handlers[which](
      new Request(`http://x/api/p/${opts.project ?? 'trees'}/runs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(opts.cookie ? { cookie: opts.cookie } : {}),
          ...(opts.as ? { [SESSION_PARTICIPANT_HEADER]: opts.as } : {}),
        },
        body: opts.raw ?? JSON.stringify(body),
        duplex: 'half',
      } as RequestInit),
      { params: { project: opts.project ?? 'trees' } },
    );
  return { ctx, cookies, call, logs };
}
