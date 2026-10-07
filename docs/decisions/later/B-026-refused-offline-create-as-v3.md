# B-026 A refused offline create leaves the map and stays in "Ausstehende Änderungen", as in v3
priority: medium        status: provisional
date: 2026-10-04   lead: b   work packages: WP-752, WP-763 (stopped), WP-767   touches: R3, R15

## Context
WP-752 tested refused-run journeys in a real browser. A feature created offline whose create run the server refuses vanishes from the device; an open sheet says "Dieses Objekt liegt nicht auf diesem Gerät." (Goal D1 of `work/WP-763-refused-offline-create-stays.md`, on branch `wp/WP-763`, not on main). WP-763 treated that as a bug and kept the feature on the map. lead-b stopped it before it landed: v3 did not do that either, so it would have been an invention (merge `076e37c2a` was reverted in `0535a61bb`). What v3 does, from its queue code:
- A refused run is stored with status `rejected` and its optimistic rows are rolled back, so the feature leaves the map (`reference/src/lib/participant-state/task-run-queue.svelte.ts:836-866`, `rollbackPrediction` at `:862`).
- A run that depends on a refused run is refused too, with status `dependent_rejected` and the reason of the first one (`:537-546`, `:581-592`, `:609-636`).
- The person fixes the problem and sends again, or discards: resend puts the run back in the queue (`:897-912`).

## Options
- A) As v3 (in force). The create disappears from the map. Its refusal stays in Einstellungen, Profil, "Ausstehende Änderungen" with the badge "Abgelehnt", the refusal sentence, "Erneut senden" and "Verwerfen" (`apps/web/messages/de.json:1666,1671,1672,1698`). Runs that build on it show "Folgeänderung abgelehnt" (WP-767, being built on branch `wp/WP-767`, not on main yet: `apps/web/messages/de.json:1674`, `packages/client/src/queue/engine.ts:127-133`, `apps/web/src/lib/participant/sheets/settings/queue-rows.ts:25`).
- B) Keep the refused feature on the map with its notice (WP-763). Friendlier, but a screen v3 never had: a feature on the map that the server never accepted.

## Chosen (provisional)
A. v3 is the default (`docs/process/rebuild.md` §3), and the engine does not force a change. Other deviations in this area remain open as small items of WP-752's list. Seam for B: the device view is built from the queue's predictions, so keeping a refused create is one decision in the queue engine's refuse step (`packages/client/src/queue/engine.ts`, see `wp/WP-763` for a tested version).

## Cost to change later
now: WP-767 only (being built). after the build: re-apply WP-763 (a client change in the queue engine plus the sheet notice, no data migration; the server never holds the refused feature, R3).
