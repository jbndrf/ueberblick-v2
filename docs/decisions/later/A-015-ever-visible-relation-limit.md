# A-015 Sync tombstones and relation-dependent `visible_when`: replay reads relations as they are now
priority: low        status: provisional
date: 2026-09-30   lead: a   work packages: WP-106, WP-137   touches: docs/07, budget (sync)

## Context
A delta carries a `feature` tombstone for a feature the participant no longer sees, but only when the device could still hold it (`sync/ever-visible.ts` replays the feature's history and asks `canSee` per state). When `visible_when` reads through a relation (`self.art.name_de == 'Linde'`), the replay takes the feature's own properties and outgoing references from its history, but reads the **related feature** (and inverse or derived relations) as it is now. If the related feature changed in between, the replay can answer "was visible" for a feature the device never held, and the delta carries an id-only tombstone for it. The device deletes nothing (it never had the row) and the tombstone holds no property values.
WP-137 also fixed a worse defect in the same place: the replayed feature's reference properties read as raw ids, and its relations came from the current edges, so a relation-dependent `visible_when` was false in every replayed state and a feature that stopped being visible was never tombstoned (the device kept it). The property test in `sync/sync.property.spec.ts` now covers both a row filter on own properties and one through a relation.

## Options
- A) Accept the limit; pin it with a test (`sync/ever-visible.spec.ts`) and document it in docs/07 (chosen). Cost: an occasional no-op tombstone.
- B) Time-travel the related features: read their properties (and inverse relations) as of each replayed seq (`observations_by_feature` supports "value as of seq"). Exact, but the replay then costs a query per related feature and state.
- C) Forbid relation-dependent `visible_when` in `compile()`. Loses a feature the docs promise (docs/06).

## Chosen (provisional)
A. The tombstone is safe (id only, idempotent on the device) and rare (a relation must change between history and now). The seam: `createEverVisible` takes its `FeatureAccess` from one place, so B replaces the `property` reads of other features with as-of versions without touching the service.

## Cost to change later
now: none · after the build: one module (`sync/ever-visible.ts`) and its tests; no protocol or data change.
