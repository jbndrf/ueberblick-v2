# A-014 A participant with no roster row gets no roles (not 401)
priority: medium        status: provisional
date: 2026-09-30   lead: a   work packages: WP-136   touches: A-006, A-009, docs/09 security

## Context
WP-136 made `AuthDeps.participantRoles` required: roles come from the project DB (`participants.roles`) on every request, and a participant with `disabled_at` set gets 401 (`credential_revoked` on exchange). Credentials (A-006) are issued by participant id, and nothing fills the `participants` roster yet (the migration and an admin roster screen will).

## Options
- A) An id with no roster row authenticates with no roles (chosen). Every task and property gated by a role refuses; only what the config grants to everyone is visible.
- B) An id with no roster row is 401, like a disabled one.

## Chosen (provisional)
A, cheapest to undo while the roster is empty: B would lock out every credential issued before the roster exists. It grants nothing a role would. The seam: `participantRolesOf(db, id)` in `packages/server/src/auth/participant-roles.ts` returns `Key[] | null`, and returning `null` for a missing row turns this into B.

## Cost to change later
small: one line in `participantRolesOf` plus its test, once the roster is filled by the migration (WP-301) or an admin screen.
