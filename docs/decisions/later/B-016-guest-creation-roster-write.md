# B-016 Guest self-join creates the participant by a system roster write, not a run
priority: medium        status: provisional
date: 2026-10-01   lead: b   work packages: WP-639   touches: R3, roster, self-join

## Context
v3's `/join/<slug>` creates a guest participant (owner §10.9 keeps it). In v4, roster changes (participants, roles, tokens) are direct admin writes in `packages/server/src/http/participants`, not runs: runs change features, the roster is not feature data. Guest creation has no admin behind it.

## Options
- A) A system roster write through the same participants service, attributed to the system and the join slug, logged like admin roster writes.
- B) Model guests as features and creation as a run.

## Chosen (provisional)
A. The roster stays one store with one write path for admins and the system; R3 covers feature data. The quota (max Objekte per participant) is a planner refusal, so feature writes still go only through runs.

## Cost to change later
low (one service call site).
