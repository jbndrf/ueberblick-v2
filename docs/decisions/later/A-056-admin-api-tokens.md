# A-056 API tokens can belong to an admin account (supersedes the "Open (admins)" part of A-037)
priority: medium        status: provisional
date: 2026-10-06   lead: c   work packages: WP-1070   touches: H4, R3, R11, R13

## Context
Owner request (2026-10-06): bring back v3's admin-issued tokens (`reference/src/lib/server/api-token.ts`, `ApiTokensSection.svelte`). A-037 parked admins ("an admin account has no participant row, so an admin token needs its own principal; today an admin signs QGIS in with the session cookie"). Use cases: QGIS with full admin rights, scripts and services (a nightly data service writing through OGC Part 4).

## Chosen (provisional)
`api_tokens.participant_id` is nullable and a new nullable `account_id` holds the issuing admin (CHECK: exactly one is set; migration 8 rebuilds the table, no shim). `authenticate` returns `{ kind: 'admin', id: account, projectId: <token's project>, roles: [] }`; the project endpoints already resolve an admin's roles with `rolesFor`, and `authorizeAs` now refuses an admin principal whose `projectId` is set and differs from the project (the token is project-scoped; a session admin has `projectId: null`). Same rules as before: `ubk_`, hashed, shown once, expiry, last used, `exchange` refuses it. The admin app itself (`locals.admin`, the settings API) reads cookies only, so a token cannot issue tokens or open the builder. `revokeAccountSessions` also revokes the account's tokens, and `authenticate` refuses a token whose account no longer exists. Runs written through such a token have actor kind `admin` and the account id (R3).
- **Seam (H4):** `scope` is unchanged; a narrower admin token is one more registry entry.
- **Open:** the instance has no "blocked admin" flag today; when one exists it must call `revokeAccountSessions`.
