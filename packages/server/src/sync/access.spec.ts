// WP-793: the pull header's `access` follows the actor's roles and is independent of the scope fingerprint.
import { describe, expect, it } from 'vitest';
import { SYNC_PROTOCOL_VERSION, type Actor } from '@ueberblick/core';
import { anna, syncSetup, tree, vera } from './testkit';

const V = SYNC_PROTOCOL_VERSION;
const withRoles = (a: Actor, roles: string[]): Actor => ({ ...a, roles: roles as unknown as Actor['roles'] });

describe('header.access', () => {
  it('changes when the roles change, and not when nothing access-related does', () => {
    const ctx = syncSetup();
    const head = (a: Actor) => ctx.service.page(a, { since: 0, scope: '', v: V }).header;
    const a = head(anna);
    expect(a.access).toBeTypeOf('string');
    expect(head(anna).access).toBe(a.access);
    ctx.seed([{ id: tree(1), type: 'baum', properties: { stage: 'erfasst' } }]);
    expect(head(anna).access).toBe(a.access);
    expect(head(vera).access).not.toBe(a.access);
  });
  it('ignores the order of the roles', () => {
    const ctx = syncSetup();
    const h = (r: string[]) =>
      ctx.service.page(withRoles(anna, r), { since: 0, scope: '', v: V }).header.access;
    expect(h(['kontrolle', 'verwaltung'])).toBe(h(['verwaltung', 'kontrolle']));
    expect(h(['kontrolle', 'verwaltung'])).not.toBe(h(['verwaltung']));
  });
  it('is independent of the scope fingerprint: a role change the scope does not see keeps it equal', () => {
    const ctx = syncSetup();
    const h = (r: string[]) => ctx.service.page(withRoles(anna, r), { since: 0, scope: '', v: V }).header;
    const one = h(['kontrolle']);
    const two = h(['kontrolle', 'unbekannt']);
    expect(two.scopeFingerprint).toBe(one.scopeFingerprint);
    expect(two.access).not.toBe(one.access);
  });
  it('rides on the stale-scope empty page too', () => {
    const ctx = syncSetup();
    const p = ctx.service.page(anna, { since: 3, scope: 'stale', v: V });
    expect(p.header.access).toBeTypeOf('string');
  });
});
