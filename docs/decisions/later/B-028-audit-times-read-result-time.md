# B-028 Audit times read the O&M resultTime
priority: medium        status: provisional
date: 2026-10-04   lead: b   work packages: WP-794   touches: H4, H5, H6 / R13 / owner M8 = (b)

## Context
Owner M8 = (b): "Erstellt" and "Zuletzt geändert" show the server receive time, as v3 (PocketBase created / updated). Observations carried only `phenomenonTime`; the receive time lived in `runs.received_at`, out of reach of the device fold.

## Options
- A) Add the O&M `resultTime` (when the result became available) to the observation, stamped at intake; `foldAudit` reads it. Device and server run the same fold (R1).
- B) A server-only `features.created_at` projection from the run. The device fold could not agree with it.
- C) A per-run receive-time map in sync. A bigger protocol change.

## Chosen (provisional)
A. `Observation.resultTime?`, column `observations.result_time` (migration 26, back-filled from `runs.received_at`, for import runs from `client_time`), additive nullable sync column. The one stamp is `resultTimeOf` (core `fold/audit.ts`), called in `store/run/transaction.ts`: receive time for every run, the historical client time for an import run, so the v3 migration keeps its times. `runs.received_at` stays the arrival time. A not yet synced run on the device has no `resultTime` and shows `phenomenonTime`, the device time, as v3 did before sync (`gateway.svelte.ts:466-474, 505-508`). `phenomenonTime` and `clampClientTime` are unchanged. Seam: `resultTimeOf`. **Confirmed by lead-b 2026-10-04:** (1) the participant timeline shows a synced run at its receive time too (`apps/web/src/lib/participant/reader.ts`), so the creating run still matches `createdAt`, consistent with v3 showing server times; (2) rules' `changed_at('prop')` keeps reading `phenomenonTime` (the work time of that property), not `resultTime`.

R13 check (`docs/11-future-capabilities.md`): H5 (external GIS) and H4/H6 (OGC) benefit, because `resultTime` is the standard O&M field next to `phenomenonTime`. No H1-H6 shape is closed: the column is additive, an older peer reads null.

## Cost to change later
now: one function and the audit read in `foldAudit`. Back to the work time: drop `resultTime ?? ` in `foldAudit` and re-run the migration-16 style back-fill (no data lost, the column stays).
