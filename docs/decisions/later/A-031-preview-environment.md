# A-031 Preview environment: v3's draft with demo data and preview logins
priority: high        status: provisional design; owner questions V1–V4 open (QUESTIONS.md "Open for owner")
date: 2026-10-01   lead: a   work packages: WP-340 … WP-344 (P1–P5), lead-b P6   touches: control.db, docs/03, docs/08, participant bootstrap

## Context
Owner §10.19 and Q17:
- "Preview = v3's draft with demo data";
- preview logins per role, so the draft can be tried on a phone;
- the test data is discarded on deploy;
- the simulator is only the engine underneath;
- nothing is live before the first publish.

v3 made a whole second project, the fork (`reference/src/lib/workflow-builder/sandbox/clone.ts:75-110,210-240`, `discard.ts:50-95`, `fork/+page.svelte:297-312`). It had one persistent participant per role plus "Keine Rolle", each with a stable `/login?token=` link. Its demo data was a **copy of the live features**, without creator, observers or files. Discarding deleted the fork entirely. v3 had no preview banner in the participant app.

## Chosen (provisional)
1. **A second DB per project**, `<dataDir>/preview-<key>.db`, served as its own project key `<key>__vorschau`.
   - It is registered in a new `control.db` table `previews` (not in `projects`), so OGC, MCP, exports, erasure, admin lists and backup never see it unless they opt in.
   - Device, sync, runs, blobs, doorbell and timers work unchanged, so a phone syncs the preview like a real project.
   - The backup regex does not match the file.
   - Project keys never contain `__`; a test pins that.
2. **The draft reaches the preview on every accepted draft save** (debounced ~1 s): `deployProject` into the preview DB.
   - A draft that does not compile keeps the last good version and reports `stale`.
   - Shape changes run automatic mappings through WP-307's executor: a removed option goes to the type's first remaining option, a removed property is discarded. Fallback: re-seed the type. "Demo-Daten zurücksetzen" re-seeds everything.
3. **Demo data** is generated server-side by the simulator's generator (`packages/builder/src/simulate/generate.ts`, plus a `center` input) as `import` runs.
   - About 5 features per type, spread over the stages, centred on the project's home view.
   - References point to generated features; participant values to preview participants.
4. **Preview logins:** one preview participant per draft role plus "Keine Rolle", with reusable readable tokens (lead-b's WP-606/607), link `/login?token=…`.
   - The logins follow the draft's roles.
   - Participant ids carry a generation, so a re-created preview gets a fresh device store.
5. **Discard on every deploy path** (publish, rollback, upgrade, admin deploy) and on project delete. This drops the preview DB, its blobs, its sessions and its participants. It is re-created lazily on the next draft save or when "Vorschau" opens.
6. **Isolation:**
   - a preview session's project id is the preview's id, so `authorizeProject` refuses it on the real project and refuses a real session on the preview;
   - only the participant routes resolve preview keys;
   - a test proves that a full preview cycle leaves the real project DB unchanged.

## Lead decisions inside the design (cheap to undo)
- Unsent device work in a discarded preview is dropped silently (test data).
- Shape changes use automatic mappings, not a full re-seed (item 2).
- Demo data comes from the generator now. A template `demo:` section would be a new feature (owner V1).

## Owner questions (QUESTIONS.md V1–V4)
- V1: a template-declared demo-data section, later?
- V2: copy a sample of live features, as v3 did?
- V3: a "Vorschau" banner in the participant app (v3 had none)?
- V4: do preview login tokens survive a deploy (v3 deleted everything)?

## Cost to change later
- now: design only;
- after it lands: the `previews` table and the `__vorschau` key convention are the seams. A namespace inside the project DB would be a rewrite.
