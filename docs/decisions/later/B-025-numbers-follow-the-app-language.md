# B-025 Sizes and percent follow the app language ("512,0 MB" in German)
priority: low        status: provisional
date: 2026-10-04   lead: b   work packages: WP-713   touches: R15

## Context
v3 wrote sizes and the storage percent with `toFixed(1)`: always a decimal point, in every language (`reference/src/routes/(participant)/map/components/SettingsSheet.svelte:373-374` for KB and MB, `:807` for the percent). WP-713 (commit `52cade9a5`) made the Offline tab format them with `Intl` in the language of the app. A German user now reads "512,0 MB" and "25,0%"; an English user reads "512.0 MB" and "25.0%". Nobody decided this on purpose; it came with the rule that dates, numbers and values follow the language. This record writes it down.

## Options
- A) Follow the app language (in force). Same words and numbers the rest of the app uses. The sizes and the percent read like the other numbers in German.
- B) Always a decimal point, as v3. Same as v3 on screen; a German user sees "512.0 MB" next to "1,5" elsewhere.

## Chosen (provisional)
A, because it is the cheapest to undo and keeps one rule for all numbers. Sizes come from one function, `formatBytes(bytes, locale)` in `apps/web/src/lib/participant/offline/format.ts:6`. The percent is formatted at the place that shows it, `apps/web/src/lib/participant/sheets/settings/offline/StorageCard.svelte:74-77` (`toLocaleString(locale, {minimumFractionDigits: 1, maximumFractionDigits: 1})`). Seam for B: change the number format in these two places. Note: the work package text named `sheets/settings/offline/format.ts`; the file is `participant/offline/format.ts`.

## Cost to change later
now: two small edits and their specs (`apps/web/src/lib/participant/offline/offline.spec.ts`). after the build: the same; no data is affected.
