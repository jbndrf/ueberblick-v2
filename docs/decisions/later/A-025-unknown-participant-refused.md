# A-025 A participant with no roster row is refused (401)
priority: medium        status: provisional
date: 2026-09-30   lead: a   work packages: WP-175   touches: supersedes A-014 (option B), A-006, docs/09 security

## Context
A-014 chose that an id with no roster row authenticates with no roles, because nothing filled the roster yet. WP-168 gives every real participant a roster row (admin CLI and API), and the migration fills it from the v3 users. A credential for an id outside the roster is now a bug or a leftover.

## Options
- A) Keep A-014: no row means no roles, and the session still starts.
- B) No row is refused, like `disabled_at`: 401 (`credential_revoked`) at exchange, and an existing session is refused.

## Chosen (provisional)
B. It fails closed: a leftover or mistyped credential grants nothing, not even what the config grants to everyone. The gap A-014 tolerated is closed by WP-168. The seam is unchanged: `participantRolesOf` in `packages/server/src/auth/participant-roles.ts` returns `null` for "refused".

## Cost to change later
small: one line in `participantRolesOf` and its test. Seeds that issue a credential must add the roster row first (`addParticipant`).
