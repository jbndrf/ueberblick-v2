# A-054 A scheduled rule can be a sweep: `idle` on `{ schedule }`
priority: medium        status: provisional
date: 2026-10-04   lead: a   work packages: WP-469   touches: H2, H5, R13, R14

## Context
Owner answer A10 = (b): v3's recurring rule fired on every instance of a workflow unchanged for N days ("Nur wenn inaktiv ≥ Tage"). v4's `{ schedule }` had no subject, so it could not read a last-change time.

## Options
- A) `rules.<key>.on: { schedule, idle? }`, `idle` a duration expression; one more optional key on the existing trigger. The server visits the Objekte; the decision "idle enough" is one core function.
- B) A new trigger kind `{ sweep: { cron, type, idle } }`. Clean, but a second schedule shape and a registry/schema/builder fork.
- C) Per-Objekt `elapsed` rules from `changed_at`. Already exists, but fires once per Objekt and re-arms only by editing, so it cannot say "every night while idle".

## Chosen (provisional)
A. The registry key `schedule` stays the only cron trigger. `ScheduleRule.types` and `.idle` (core `rules/timing`) are the seam: the simulator and later dispatch (H2) and the command centre (H5) read "what the sweep visits and when" from them. The sweep cursor is one `timers` row per rule, `feature_id = '~sweep:<start>|<last id>'`, so no table or migration. The cutoff is the sweep's start instant (as v3's `run.at`), and one sweep runs per rule at a time.

R13: H1-H6 are untouched (no domain property, no I/O in core; `idle` is a rule-language expression, so a property-based idle such as `days(self.ruhe_tage)` is possible). R14: a tick visits at most `limit` Objekte (default 500) through `features(type, id)`, with a `changed_at` prefilter when `idle` is a constant exact duration; `bench/timers` measures 0.018 ms per visited Objekt (budget 0.5).

## Cost to change later
now: small (one optional key, one function, one spec file). After the build: moving the cursor to its own table is a server-only change; changing the key to a new trigger kind is a schema migration of projects that use `idle` (few).
