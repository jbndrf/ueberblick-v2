# A-008 Admin API authorization: any project membership, templates published by any admin
priority: medium        status: provisional
date: 2026-09-29   lead: a   work packages: WP-113, WP-114   touches: O10, O12, docs/09 security

## Context
WP-113 mounted the admin API (`/api/admin/p/<project>/deploy|plan|versions`). The data model has `memberships(account, project, role)` but no admin role catalogue yet.

## Options
- A) Any membership in the project grants the admin API (chosen for now); template publishing by any admin account.
- B) Admin roles from a registry (owner, editor, viewer) checked per endpoint; a server-level role for publishing templates.

## Chosen (provisional)
A, cheapest to undo. The seam: `authorizeAdmin` in `apps/web/src/lib/server/authz.ts` — one function, so B is a registry plus a check per route.

## Cost to change later
small: a role registry, one check per admin route, a migration assigning existing memberships a role.
