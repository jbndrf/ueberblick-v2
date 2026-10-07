# A-018 MCP `apply` confirmation: same-origin human step now, a separate assistant credential later
priority: medium        status: provisional
date: 2026-09-30   lead: a   work packages: WP-211   touches: docs/11 H4 (AI assistants), docs/09 security, A-008, A-011

## Context
WP-211 added the builder MCP server (`POST /api/mcp/<project>`). Its `apply` tool writes the working draft (never deploys) and needs an HMAC confirmation token. The token is bound to project, draft revision, resulting overlay text and a 10-minute expiry, and is issued by `POST /api/mcp/<project>/confirm`, a human step. Both endpoints use `authorizeAdmin` (A-008), meaning the admin's session. `/confirm` only accepts `Sec-Fetch-Site: same-origin`.

An assistant that holds the same admin session cookie could forge that header, so it could confirm its own proposal.

## Options
- A) Same-origin check on `/confirm` (chosen for now): a speed bump, not a boundary.
- B) A separate assistant credential (scoped token, per project, revocable), so the MCP endpoint authenticates the assistant and not the admin, and only an admin session can call `/confirm`.
- C) Confirmation only through the builder UI (a signed UI action), never via HTTP from the assistant's side.

## Chosen (provisional)
A, cheapest to undo, and the blast radius is small. `apply` changes only the draft (A-011): every change is visible in the builder, diffable, and still needs a human deploy. The seam: the `ConfirmationPort` in `packages/builder/src/mcp`, so B or C replaces one port implementation. The builder UI button that calls `/confirm` is not built yet (follow-up with B).

## Cost to change later
medium: B needs a credential kind (docs/04 control DB, A-006 pattern) and admin UI to issue and revoke it; C needs the UI button and a signed action. Neither changes the MCP tool surface.
