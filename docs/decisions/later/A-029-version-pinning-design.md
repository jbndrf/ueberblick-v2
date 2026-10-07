# A-029 Version pinning (Q25): engine design
priority: high        status: provisional design; four owner questions open (QUESTIONS.md "Open for owner", P1–P4)
date: 2026-10-01   lead: a   work packages: WP-311 … WP-318 (pinning series, after WP-305 and WP-307)   touches: docs/03 / docs/04 / docs/07 / docs/08

## Context
Owner Q25: "running features may keep the version they started with". In v3, the admin chose once per workflow at release time, on the fork page:
- the choice was "Laufende Fälle auf alter Version belassen" (the default) or "migrate" (`reference/src/routes/admin/projects/[projectId]/fork/+page.svelte:65-79,230-239`, `reference/src/lib/workflow-builder/sandbox/release.ts:144-212`);
- the choice was shown only when running cases existed (`pushback.ts:225-237`);
- completed and archived cases never moved;
- new cases always took the current version;
- a pinned case showed its frozen version's tasks, forms and stages.

Today the server already plans each run against `config@run.configVersion`. But `features.config_version` is just "who wrote last", and sync, timers and derive know only the deployed version.

## Chosen (provisional)
1. **Reserved key `$version`.**
   - Absent means the feature **floats** on the deployed version; present means it is pinned.
   - Creation writes no pin. A deploy that keeps type T pins T's running features to the previous version with one system run each; "move" writes nothing but the value moves (WP-307).
   - `features.pinned_version` is its projection (partial index).
   - The effective version is `coalesce(pinned_version, deployed)`.
2. **plan** takes a resolver `configFor(feature | new)`:
   - a create uses the deployed version;
   - a write to another feature is validated under that feature's version;
   - a rule run uses its subject's version.
   - **L1 (lead decision):** a run planned on a device under another version than the feature's is **replanned under the feature's version**. A refusal from that replan goes to review, as usual ("server facts win", docs/07).
3. **fold, rules, derive and timers** group the touched features by effective version. No work grows with the number of features. Timers record their config version.
4. **Sync:**
   - the live set is `{deployed} ∪ distinct pinned`;
   - the visibility SQL is a union of per-version predicates over that set;
   - readable properties are resolved per row version;
   - the fingerprint covers the live set;
   - each row carries `version`, and the header carries `versions { deployed, live }`.
   - The device prefetches live versions and prunes the rest (except versions referenced by queued runs).
5. **Deploy:**
   - per Objektart "belassen" or "verschieben", shown only for changed types with running features;
   - affected counts: floating features that would move, already pinned, per removed option.
   - Retirement is computed: a version without pins and not deployed leaves the live set. `config_versions` rows are never deleted.

## Options not chosen
- A pin written on every create: a deploy would have to rewrite every feature.
- Refuse stale-version runs (`config_version_moved`): offline work would be lost more often than with a replan.
- A per-change granularity: a version is the whole project file.

## Cost to change later
- now: design only;
- after the series lands: the reserved key and the sync fields are protocol. Changing them needs a sync protocol bump.
