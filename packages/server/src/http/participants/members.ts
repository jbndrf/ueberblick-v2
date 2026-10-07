/**
 * Who has one role: v3's "Teilnehmende bearbeiten" (`roles/+page.svelte:612-657`, action `updateParticipants`) as one
 * change set per role, so a dialog that adds three people and removes one makes one request, not four. Like every
 * roster change it applies at once and is not part of the draft (Q13).
 */
import type { Done, RosterCtx } from './roster';
import { fail } from './roster';
import { knownRoles } from './roles';

export interface RoleMembersChange {
  /** Participants who get the role (already having it is fine). */
  readonly add: readonly string[];
  /** Participants who lose it (not having it is fine); a person named in both loses it. */
  readonly remove: readonly string[];
}

/** All or nothing: an unknown role or person refuses the whole change and writes nothing. */
export function setRoleMembers(ctx: RosterCtx, role: string, change: RoleMembersChange): Done {
  const have = knownRoles(ctx.db, ctx.templates);
  if (have && !have.has(role)) return fail('unknown_role', role);
  const ids = [...new Set([...change.add, ...change.remove])];
  const stored = new Map<string, string[]>();
  const select = ctx.db.prepare<{ roles: string }>('SELECT roles FROM participants WHERE id = ?');
  for (const id of ids) {
    const found = select.get(id);
    if (!found) return fail('participant_unknown', id);
    stored.set(id, JSON.parse(found.roles) as string[]);
  }
  const removing = new Set(change.remove);
  const adding = new Set(change.add);
  ctx.db.transaction(() => {
    for (const [id, roles] of stored) {
      const has = (roles.includes(role) || adding.has(id)) && !removing.has(id);
      const next = has ? (roles.includes(role) ? roles : [...roles, role]) : roles.filter((r) => r !== role);
      ctx.db.prepare('UPDATE participants SET roles = ? WHERE id = ?').run(JSON.stringify(next), id);
    }
  });
  return { ok: true };
}
