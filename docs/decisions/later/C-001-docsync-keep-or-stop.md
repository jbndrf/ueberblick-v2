# C-001 docsync stays on probation: stop it if its edit-or-reject share stays above 50%
priority: medium        status: provisional
date: 2026-09-30   lead: c   work packages: WP-907, WP-910   touches: process cost (Claude tokens), R16

## Context
Course check 004 (strategist) called docsync possibly net-negative. Data up to 2026-09-30 19:50 (`metrics/raw/docsync.jsonl`): 51 branches reviewed, 23 merged as-is (45%), 20 edited by the lead (39%), 8 rejected (16%). Failure modes: stale bases causing conflicts or repeated edits, invented UI labels (754ea2f got through), dropped words. Reviewing costs about 25k Claude tokens per branch (fork reviews), and R16 already makes implementers update the docs in the same work package, so docsync is a second pass.

## Options
- A) Stop docsync now. Saves the review tokens, loses the second pass on docs drift.
- B) Keep it as is. Pays the cost for a 45% clean rate.
- C) Keep it on probation with the new guards (WP-907: fresh base, dropped hunks reported; WP-910: `lint:ui-strings` fails invented labels), measure the next 20 branches, and stop it if edited+rejected stays above 50%.

## Chosen (provisional)
C, because the guards target the two largest failure modes and cost nothing to keep. The seam is `scripts/docsync/watch.mjs` (the service): stopping it is one `systemctl --user disable docsync` and one line in `docs/process/docsync.md`.

## Cost to change later
now: nothing · after the build: nothing (a service toggle and a doc line)

## Result of the probation (2026-10-01 02:50)
After 19 of the 20 probation branches (since 2026-09-30 17:56Z): 13 merged as-is, 4 edited, 2 rejected. That is a 32% edit-or-reject share. The single branch left can't push it past 50%. docsync stays. Both rejections were stale (main had already rewritten the paragraph), not wrong. WP-924 added two prompt rules (German in `docs/user/**`, UI labels verbatim from the catalogues) for the two edit patterns seen.
