# B-029 A transaction hook that throws: named 500, busy stays 503, the run is rolled back, never refused
priority: low        status: provisional
date: 2026-10-05   lead: b   work packages: WP-860 (follow-up of WP-841, WP-842)   touches: R3 / sync (docs/07)

## Context
The timers hook (`packages/server/src/timers/timers.ts`, `hook`) runs inside the run transaction (`store/run/transaction.ts`, after the fold). Path before this decision: it throws, `db.transaction` rolls the run back, `submit` rethrows, the intake (`http/runs/handlers.ts`, `failed`) logs `run.failed code=<error name>` and rethrows, SvelteKit answers 500. The device queue treats every 5xx as transient and retries with capped backoff, so a persistent fault retries forever.

## Options
- A) Refuse the run (422). Wrong: a typed refusal is final and the device would discard a valid run for a server fault.
- B) Move the timers write after the commit, like the WP-842 hooks. Not done: the `timers` row must agree with the folded feature in the same transaction (a crash between commit and write leaves a feature whose due time is never scheduled, and nothing rebuilds it at startup). Out of scope; report only.
- C) Keep the rollback. `SQLITE_BUSY`/`SQLITE_LOCKED` inside the hook passes through unchanged (503 `busy`, retryable). Any other throw becomes `HookFailed` (`code = hook_<name>`, cause kept), answered 500 and logged `run.failed code=hook_timers`.

## Chosen (provisional)
C. The run is never refused for an internal fault. The seam: `TransactionHook.hookName` and `HookFailed` in `store/run/contract.ts`, so a later outbox hook is named the same way, and moving a hook after the commit (B) or a dead-letter for a poison run stays open.

## Cost to change later
now: one error class, a try/catch around the hook loop, one `hookName` on the timers hook · after the build: a retry cap or dead-letter is a client queue change (docs/07), not a server one.
