# A-006 QR login tokens are one-time (no reusable badges)
priority: medium        status: provisional
date: 2026-09-29   lead: a   work packages: WP-103   touches: docs/09 security, O10

## Context
v3 put a 90-day token in the login URL (docs/10 anti-pattern). WP-103 made the QR a one-time bootstrap token exchanged for a session cookie; a second scan returns `credential_used`.

## Options
- A) One-time QR per device (chosen): a lost phone or a photographed QR cannot be replayed; a new device needs a new QR from the admin.
- B) Reusable badge QR with a device limit: convenient for shared devices and shift work, but a photo of the badge is a credential.

## Chosen (provisional)
A, per docs/09. The seam: the claim in `packages/server/src/auth/service.ts` (`exchange`) — a reusable mode would be a credential flag plus a device counter, no schema change beyond one column.

## Cost to change later
now: small · after the build: one column in `credentials`, one branch in `exchange`, admin UI option; no data migration.
