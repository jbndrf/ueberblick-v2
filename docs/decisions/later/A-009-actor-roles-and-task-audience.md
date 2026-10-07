# A-009 `actor.roles` only (no `actor.role`); task audience stays CEL for now
priority: high        status: provisional
date: 2026-09-29   lead: a   work packages: WP-011.1, WP-300, WP-042   touches: H2, H3, O12, F5, F6

## Context
Course check 003: docs/06 and the checker env offer `actor.role` (singular), but `model.ts Actor` has only `roles`; every golden template uses `actor.role == 'x'`, and the v3 converter (WP-300) would emit it. For a participant with several roles it is undefined. Task availability is gated only by CEL `when`, while perms uses subjects (`<kind>:<key>`), which is teams-ready (H2, O12).

## Options
- A) Drop `actor.role`; write `'x' in actor.roles`. Additive later: an *active role* (the role app a participant is using, H3) as `actor.role`, carried on the run.
- B) Define `actor.role` now as the active role: runs must carry it, plan must validate it, the device must choose it — more contract before Phase 4 settles.
- C) Keep both undefined-for-multi-role (status quo) — a silent bug.

## Chosen (provisional)
A — cheapest to undo and never wrong. A task audience through perms subjects (so teams can be granted a task without CEL) is noted as the next step, not built: the seam is the perms `run` check (`perms/contract.ts`), which already takes subjects.

## Cost to change later
now: golden templates, docs/05/06, checker env, compile's `never_available` role check (WP-011.1) · after the build: adding an active `actor.role` is additive; removing it later would need a file migration — hence not adding it now.
