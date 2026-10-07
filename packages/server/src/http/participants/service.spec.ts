import { describe, expect, it } from 'vitest';
import { isAuthError } from '../../auth/contract';
import { importParticipant, removeParticipant } from './roster';
import { issueQr, listQrs, revokeQrs } from './service';
import { world } from './testkit';

describe('QR credentials', () => {
  it('an issued QR exchanges to a session whose actor has the roster roles', () => {
    const { ctx, auth } = world();
    importParticipant(ctx, { id: 'anna', roles: ['kontrolle'] });
    const q = issueQr(ctx, 'anna');
    if (!q.ok) throw new Error(q.code);
    const s = auth.exchange(q.token);
    if (isAuthError(s)) throw new Error(s.code);
    expect(auth.toActor(s.principal)).toEqual({ id: 'anna', kind: 'participant', roles: ['kontrolle'] });
    expect(auth.authenticate(s.id)?.roles).toEqual(['kontrolle']);
  });

  it('revoke ends the credential and the session', () => {
    const { ctx, auth } = world();
    importParticipant(ctx, { id: 'anna', roles: ['kontrolle'] });
    const a = issueQr(ctx, 'anna');
    const b = issueQr(ctx, 'anna');
    if (!a.ok || !b.ok) throw new Error('issue');
    const s = auth.exchange(a.token);
    if (isAuthError(s)) throw new Error(s.code);
    revokeQrs(ctx, 'anna');
    expect(auth.authenticate(s.id)).toBeNull();
    expect(auth.exchange(b.token)).toEqual({ code: 'credential_revoked' });
  });

  it('removing a participant ends their session and blocks new QRs', () => {
    const { ctx, auth } = world();
    importParticipant(ctx, { id: 'anna', roles: [] });
    const q = issueQr(ctx, 'anna');
    if (!q.ok) throw new Error(q.code);
    const unspent = issueQr(ctx, 'anna');
    if (!unspent.ok) throw new Error(unspent.code);
    const s = auth.exchange(q.token);
    if (isAuthError(s)) throw new Error(s.code);
    removeParticipant(ctx, 'anna');
    expect(auth.authenticate(s.id)).toBeNull();
    expect(auth.exchange(unspent.token)).toEqual({ code: 'credential_revoked' });
    expect(issueQr(ctx, 'anna')).toEqual({ ok: false, code: 'participant_disabled' });
  });

  it('a participant disabled directly in the roster fails both exchange and authenticate', () => {
    const { ctx, auth, db } = world();
    importParticipant(ctx, { id: 'anna', roles: ['kontrolle'] });
    const a = issueQr(ctx, 'anna');
    const b = issueQr(ctx, 'anna');
    if (!a.ok || !b.ok) throw new Error('issue');
    const s = auth.exchange(a.token);
    if (isAuthError(s)) throw new Error(s.code);
    db.prepare('UPDATE participants SET disabled_at = ? WHERE id = ?').run(
      '2026-01-01T00:00:00.000Z',
      'anna',
    );
    expect(auth.authenticate(s.id)).toBeNull();
    expect(auth.exchange(b.token)).toEqual({ code: 'participant_disabled' });
  });

  it('issues only for a roster participant, with no default expiry (v3) and a custom one', () => {
    const { ctx, advance } = world();
    expect(issueQr(ctx, 'ghost')).toEqual({ ok: false, code: 'participant_unknown' });
    importParticipant(ctx, { id: 'anna', roles: [] });
    const d = issueQr(ctx, 'anna');
    expect(d.ok && d.expiresAt).toBeNull();
    const c = issueQr(ctx, 'anna', '2026-01-02T00:00:00.000Z');
    expect(c.ok && c.expiresAt).toBe('2026-01-02T00:00:00.000Z');
    expect(issueQr(ctx, 'anna', 'soon')).toEqual({ ok: false, code: 'invalid_expiry' });
    advance(10 * 24 * 3600 * 1000);
    expect(issueQr(ctx, 'anna', '2026-01-02T00:00:00.000Z')).toEqual({ ok: false, code: 'invalid_expiry' });
  });

  it('lists active credentials without the token; expired ones drop out, used ones stay', () => {
    const { ctx, auth, advance } = world();
    importParticipant(ctx, { id: 'anna', roles: [] });
    importParticipant(ctx, { id: 'bernd', roles: [] });
    const a = issueQr(ctx, 'anna');
    const used = issueQr(ctx, 'anna');
    const short = issueQr(ctx, 'bernd', '2026-01-01T01:00:00.000Z');
    if (!a.ok || !used.ok || !short.ok) throw new Error('issue');
    auth.exchange(used.token);
    advance(2 * 3600 * 1000);
    const list = listQrs(ctx);
    expect(list).toEqual([
      { participantId: 'anna', expiresAt: null },
      { participantId: 'anna', expiresAt: null },
    ]);
    expect(JSON.stringify(list)).not.toContain(a.token);
    expect(listQrs(ctx, 'bernd')).toEqual([]);
  });
});
