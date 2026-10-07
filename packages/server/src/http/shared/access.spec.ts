import { describe, expect, it } from 'vitest';
import type { Key } from '@ueberblick/core';
import type { Principal } from '../../auth';
import { authorizeProject } from './access';
import type { ProjectAccessDeps } from './contract';

// WP-705: an admin and a participant session sit in one browser, one cookie each; a project endpoint accepts either.
const sessions: Record<string, Principal> = {
  pid: { kind: 'participant', id: 'anna', projectId: 'p1', roles: ['r' as Key] },
  other: { kind: 'participant', id: 'bob', projectId: 'p2', roles: ['r' as Key] },
  aid: { kind: 'admin', id: 'root', projectId: null, roles: [] },
};
const deps: ProjectAccessDeps = {
  auth: {
    authenticate: (id) => (id ? (sessions[id] ?? null) : null),
    toActor: (p) => ({ id: p.id, kind: p.kind, roles: p.roles }),
    rolesFor: (id, project) => (id === 'root' && project === 'p1' ? ['verwaltung' as Key] : []),
  },
  project: (key) => (key === 'demo' ? { id: 'p1', key } : undefined),
};
const DEVICE = ['participant', 'admin'] as const;
const req = (cookie: string) => new Request('http://x/', { headers: { cookie } });
const code = async (r: unknown): Promise<string> =>
  r instanceof Response ? ((await r.json()) as { error: { code: string } }).error.code : 'ok';

describe('authorizeProject with two cookies', () => {
  it('accepts the participant cookie alone', async () => {
    expect(await code(authorizeProject(deps, req('ub_session_participant=pid'), 'demo', DEVICE))).toBe('ok');
  });
  it('accepts the admin cookie alone', async () => {
    const r = authorizeProject(deps, req('ub_session_admin=aid'), 'demo', DEVICE);
    expect(r instanceof Response ? null : r.actor.kind).toBe('admin');
  });
  it('with both cookies and kinds participant-first, a participant of the project answers, never the admin', () => {
    const r = authorizeProject(deps, req('ub_session_participant=pid; ub_session_admin=aid'), 'demo', DEVICE);
    expect(r instanceof Response ? null : [r.actor.kind, r.actor.id, r.actor.roles]).toEqual([
      'participant',
      'anna',
      ['r'],
    ]);
  });
  it('participant-first falls back to the admin when the participant belongs to another project', () => {
    const r = authorizeProject(
      deps,
      req('ub_session_participant=other; ub_session_admin=aid'),
      'demo',
      DEVICE,
    );
    expect(r instanceof Response ? null : r.actor.id).toBe('root');
  });
  it('an admin-only endpoint ignores a valid participant cookie', async () => {
    const both = authorizeProject(deps, req('ub_session_participant=pid; ub_session_admin=aid'), 'demo', [
      'admin',
    ]);
    expect(both instanceof Response ? null : both.actor.kind).toBe('admin');
    expect(await code(authorizeProject(deps, req('ub_session_participant=pid'), 'demo', ['admin']))).toBe(
      'unauthenticated',
    );
  });
  it('a participant-only endpoint ignores an admin cookie', async () => {
    expect(await code(authorizeProject(deps, req('ub_session_admin=aid'), 'demo', ['participant']))).toBe(
      'unauthenticated',
    );
  });
  it('401 without any cookie, 403 when a session has no access', async () => {
    expect(await code(authorizeProject(deps, req(''), 'demo', DEVICE))).toBe('unauthenticated');
    expect(await code(authorizeProject(deps, req('ub_session_participant=other'), 'demo', DEVICE))).toBe(
      'forbidden',
    );
  });
  it('a cookie that holds the other kind counts as absent', async () => {
    expect(await code(authorizeProject(deps, req('ub_session_admin=pid'), 'demo', DEVICE))).toBe(
      'unauthenticated',
    );
    expect(await code(authorizeProject(deps, req('ub_session_participant=aid'), 'demo', DEVICE))).toBe(
      'unauthenticated',
    );
  });
});
