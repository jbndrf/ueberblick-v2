import { describe, expect, it } from 'vitest';
import type { Authenticated } from '@ueberblick/server';
import { sessionsOf } from './sessions';

const known: Record<string, Authenticated> = {
  pid: { kind: 'participant', id: 'anna', projectId: 'p1', roles: [] },
  aid: { kind: 'admin', id: 'root', projectId: null, roles: [] },
};
const auth = { authenticate: (id: string | null | undefined) => (id ? (known[id] ?? null) : null) };
const req = (cookie: string) => new Request('http://x/', { headers: { cookie } });

describe('sessionsOf (WP-705)', () => {
  it('resolves both cookies side by side', () => {
    const s = sessionsOf(req('ub_session_participant=pid; ub_session_admin=aid'), auth);
    expect(s.participant?.id).toBe('anna');
    expect(s.admin?.id).toBe('root');
    expect(s.participantId).toBe('pid');
  });

  it('one cookie alone leaves the other session null', () => {
    const onlyP = sessionsOf(req('ub_session_participant=pid'), auth);
    expect([onlyP.participant?.id, onlyP.admin]).toEqual(['anna', null]);
    const onlyA = sessionsOf(req('ub_session_admin=aid'), auth);
    expect([onlyA.participant, onlyA.admin?.id]).toEqual([null, 'root']);
  });

  it('a cookie that holds the other kind counts as absent', () => {
    const s = sessionsOf(req('ub_session_participant=aid; ub_session_admin=pid'), auth);
    expect(s.participant).toBeNull();
    expect(s.admin).toBeNull();
  });

  it('the old shared cookie name is not read (no shim, R11)', () => {
    const s = sessionsOf(req('ub_session=aid'), auth);
    expect(s.admin).toBeNull();
    expect(s.participant).toBeNull();
  });
});
