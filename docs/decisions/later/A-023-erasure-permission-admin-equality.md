# A-023 Erasure permission and restore replay are coupled to "all admins are equal"
priority: high        status: provisional
date: 2026-09-30   lead: a   work packages: WP-142.2, WP-168   touches: H2 / H4 / H5 / docs/09 (GDPR Art. 17) / A-008, B-006, A-021, A-022

## Context
From course check 004. Since A-021 an erasure is an ordinary run of a `redact` task; its `when` in the golden template admits `actor.kind == 'admin'`. A-008 and B-006 make all admins equal: `memberships.role` exists but never reaches `actor.roles`. A-022 replays erasures after a restore under an admin restore actor. So any admin can irreversibly erase anyone with no confirmation. And if a project restricts the erasure task (for example to a data-protection officer role), backup restore replay **fails**, because the restore actor has no role.

## Options
- A) Keep it (admins equal; erasure open to all admins). Simple, but it blocks H2 and H5 role separation and is a compliance weakness.
- B) Admin membership roles reach `actor.roles` (from `memberships.role`), and the restore actor carries an explicit `restore` role that erasure tasks are told to admit, in the template guidance. A DPO-only erase task then works, and replays.
- C) Replay bypasses task permission. Rejected: it is a second write path (R3).

## Chosen (provisional)
A for now (no code change in this build), with B as the named direction. The seams already exist: `replayActor()` (one function) and the actor-roles resolution in auth. The final report lists this as a top-5 lock-in for the owner, to decide **before the WP-303 pilot**.

## Cost to change later
now: an auth change (roles from memberships) plus one line in `replayActor` plus template guidance · after the pilot: every tenant's erasure task `when` must be reviewed
