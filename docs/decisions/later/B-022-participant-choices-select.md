# B-022 A participant property says who may choose whom (`select`), and the sync ships the choosable people
priority: medium        status: provisional
date: 2026-10-03   lead: b   work packages: WP-725   touches: R13 (none blocked), H3 role apps, H2 dispatch, A-028 privacy

## Context
"Zuweisen" offered only the caller, as a raw id. v3 offered the project's participants by name, gated per field by the caller's role (`reference/pb/pb_hooks/selectable_entities.pb.js:54-103`: `any_select_roles` gives everyone, `self_select_roles` only oneself, otherwise nothing; `FieldRenderer.svelte:207-208`, cached offline by `gateway.svelte.ts:343-373`). The device knew only the actors of synced runs (`people`), without roles and not everybody.

## Options
- A) `participant` property option `select: { all: [roles], self: [roles] }` plus the sync shipping the choosable people (id, name) to callers in some `select.all`. A port of v3's rule.
- B) Widen the activity `people` to all participants for every role that sees names. Leaks names without a per-field gate.
- C) Gate by the existing `activity_names` flag. Conflates seeing who acted with assigning to anyone.

## Chosen (provisional)
A. Absent `select` keeps today's behaviour (only oneself). A caller in neither list gets no choices (v3 default deny). The people ride on the existing `people` table as rows with `choosable: true` (additive wire column `choosable` and header field `choosable`, protocol stays 3); the device sends the hash of the set it holds and the server ships the whole list, replacing the device's set, only when the hash differs; name only, never an email; disabled participants are left out; a participant without a name is shipped with an empty name and shown as "Jemand". The scope fingerprint covers whether the caller may choose anyone, so a change of `select` re-snapshots. The seam is `select` (schema/property-select.ts): a role app or dispatch can add a key (a filter by role of the chosen person, a team) without changing the wire.

## Cost to change later
now: schema option, one additive wire column and one request field, one store accessor. After the build: replacing the source of the list touches `server/src/sync/choosable.ts` (`withChoosable`) only; the device reads `store.choosableParticipants()`.
