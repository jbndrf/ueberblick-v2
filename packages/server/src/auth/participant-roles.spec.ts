import { describe, expect, it } from 'vitest';
import { importParticipant, removeParticipant } from '../http/participants';
import { world } from '../http/participants/testkit';
import { isAuthError } from './contract';
import { participantRolesOf } from './participant-roles';

describe('participantRolesOf (A-025: no roster row is refused)', () => {
  it('reads the roles; null for an unknown or disabled participant', () => {
    const { ctx, db } = world();
    importParticipant(ctx, { id: 'anna', name: 'Anna', roles: ['kontrolle', 'bauhof'] });
    importParticipant(ctx, { id: 'bernd', roles: [] });
    removeParticipant(ctx, 'bernd');
    expect(participantRolesOf(db, 'anna')).toEqual(['kontrolle', 'bauhof']);
    expect(participantRolesOf(db, 'nobody')).toBeNull();
    expect(participantRolesOf(db, 'bernd')).toBeNull();
  });

  it('sees a change at once (no cache)', () => {
    const { ctx, db } = world();
    importParticipant(ctx, { id: 'anna', roles: ['kontrolle'] });
    db.prepare('UPDATE participants SET roles = ? WHERE id = ?').run('["verwaltung"]', 'anna');
    expect(participantRolesOf(db, 'anna')).toEqual(['verwaltung']);
  });

  it('a QR for an id without a roster row is refused at exchange (401)', () => {
    const { auth, ctx } = world();
    const ghost = auth.exchange(auth.issueCredential(ctx.projectId, 'ghost').token);
    expect(ghost).toEqual({ code: 'participant_disabled' });
  });

  it('a removed participant loses the live session', () => {
    const { auth, ctx } = world();
    importParticipant(ctx, { id: 'carla', roles: ['kontrolle'] });
    const s = auth.exchange(auth.issueCredential(ctx.projectId, 'carla').token);
    if (isAuthError(s)) throw new Error(s.code);
    expect(auth.authenticate(s.id)).not.toBeNull();
    removeParticipant(ctx, 'carla');
    expect(auth.authenticate(s.id)).toBeNull();
  });
});
