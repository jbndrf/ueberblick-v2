import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { addParticipant, listParticipants } from './roster';
import { setRoleMembers } from './members';
import { world } from './testkit';

function deploy(w: ReturnType<typeof world>, roles: readonly string[]): void {
  w.db
    .prepare(
      `INSERT INTO config_versions (version, schema, overlay, compiled, hash, status, created_at)
       VALUES (1, 'ueberblick/1', '{}', ?, 'h1', 'deployed', '2026-01-01T00:00:00.000Z')`,
    )
    .run(JSON.stringify({ file: { roles: Object.fromEntries(roles.map((r) => [r, {}])) } }));
}

function person(w: ReturnType<typeof world>, name: string, roles: string[] = []): string {
  const r = addParticipant(w.ctx, { name, roles });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.id;
}
const rolesOf = (w: ReturnType<typeof world>, id: string): readonly string[] =>
  listParticipants(w.ctx).find((p) => p.id === id)?.roles ?? [];

describe('setRoleMembers: one change set for one role', () => {
  it('adds some people and removes others in one call, keeping their other roles', () => {
    const w = world();
    deploy(w, ['gutachter', 'leitung']);
    const a = person(w, 'Anna', ['leitung']);
    const b = person(w, 'Ben', ['gutachter', 'leitung']);
    const c = person(w, 'Cem');
    expect(setRoleMembers(w.ctx, 'gutachter', { add: [a, c], remove: [b] })).toEqual({ ok: true });
    expect(rolesOf(w, a)).toEqual(['leitung', 'gutachter']);
    expect(rolesOf(w, b)).toEqual(['leitung']);
    expect(rolesOf(w, c)).toEqual(['gutachter']);
  });

  it('refuses an unknown role and an unknown person, and changes nothing', () => {
    const w = world();
    deploy(w, ['gutachter']);
    const a = person(w, 'Anna');
    expect(setRoleMembers(w.ctx, 'nix', { add: [a], remove: [] })).toMatchObject({
      ok: false,
      code: 'unknown_role',
    });
    expect(setRoleMembers(w.ctx, 'gutachter', { add: [a, 'ghost'], remove: [] })).toMatchObject({
      ok: false,
      code: 'participant_unknown',
    });
    expect(rolesOf(w, a)).toEqual([]);
  });

  it('is idempotent: adding a member twice keeps one entry; removing a non-member is fine', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (addFirst, removeToo) => {
        const w = world();
        deploy(w, ['r']);
        const a = person(w, 'Anna');
        setRoleMembers(w.ctx, 'r', { add: [a, a], remove: [] });
        setRoleMembers(w.ctx, 'r', addFirst ? { add: [a], remove: [] } : { add: [], remove: [] });
        if (removeToo) setRoleMembers(w.ctx, 'r', { add: [], remove: [a, a] });
        expect(rolesOf(w, a)).toEqual(removeToo ? [] : ['r']);
      }),
      { numRuns: 20 },
    );
  });
});
