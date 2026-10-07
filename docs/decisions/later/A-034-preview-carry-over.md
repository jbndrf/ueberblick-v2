# A-034 Preview carry-over: the preview is not discarded on a deploy, and it has logins
priority: high        status: provisional contract (lead-a); follows the owner's answers V1–V4 (2026-10-02)
date: 2026-10-03   lead: a (server and admin UI), b (participant banner, WP-679)   work packages: WP-373, WP-679   touches: A-031 (supersedes item 5), A-029, R13 / R14 / docs/03, docs/08

## Context
A-031 designed the preview environment: a second database per project (`<key>__vorschau`), the draft deployed into it on every save, generated demo data, preview logins per role, and (item 5) **discarded on every deploy path**. The owner answered V1–V4 (QUESTIONS.md, "Owner answers 2026-10-02"):
- **V1** the demo data is generated (about 5 per Objektart), and "Demo-Daten zurücksetzen" regenerates it on demand.
- **V2** no copy of live data into the preview.
- **V3** the participant app shows a banner on a preview login (WP-679).
- **V4** the tokens stay, and the preview's data (demo data plus what testers entered) is **migrated into the next preview with the same value moves as the live deploy**, not discarded.

V4 contradicts item 5. This record supersedes item 5 only; items 1–4 and 6 of A-031 stand.

## Chosen (provisional)
1. **No deploy path drops the preview.** Publish, rollback, upgrade and admin deploy all end in `afterDeploy` of the real project (`ProjectServices.afterDeploy`, wrapped in the runtime). That one seam calls `previews.carryOver(projectKey)` for a project that has a live preview. Only a project **delete** drops the preview for good (database, files, sessions, tokens, row).
2. **The same value moves, from one source (R1).** The live deploy records its `{ to }` mappings as `deploy_moves` rows. `carryOver` reads the rows of the new live version (`recordedMappings`, `packages/server/src/deploy/moves.ts`) and deploys the preview's config with them through the same `deployProject` and the same executor, run against the preview database. The automatic mappings of a draft save (A-031 item 2) are the base, and the live mappings win over them. A live `{ discard }` writes no row, so the preview keeps its automatic choice for it.
3. **What the preview follows.** The draft, as before; without a draft (an admin deploy of a file) the live deployed config. A preview that cannot be carried over (the draft does not compile) never fails the live deploy: the error is logged and the next draft save refreshes it.
4. **Preview logins (A-031 item 4, built).**
   - One preview participant per role of the deployed draft plus "Keine Rolle", with a reusable readable token of the auth module (WP-606) under the preview's id as project id. The id is `preview-g<generation>-r-<role>` or `preview-g<generation>-none`.
   - Every refresh syncs them: a new role gets a login, a removed role's token is revoked and its sessions end. Tokens stay across saves **and deploys**.
   - `GET /builder-api/<project>/preview[?locale=]` answers `{ status, problems, version, updatedAt, logins: [{ role, label, participantId, token, link }] }` to the project admin only. `link` is relative (`/login?token=…`).
   - The admin sees them in the deploy overview (WP-360), under the changes, as v3 did on its release page: a row per role with the link and "Link kopieren".
5. **"Demo-Daten zurücksetzen"** (`POST /builder-api/<project>/preview/reset`, a button in the same card, behind a confirm question) drops the preview database with `keepLogins`, bumps the generation (so the device gets a fresh store), re-deploys the draft, seeds new demo data and **moves the tokens** to the new generation's participants (`Auth.reassignCredentials`). The same links keep working, sign-in is needed again.
6. **The preview flag for the device (V3).** `GET /participant-api/bootstrap` answers `project.preview: boolean`, computed on the server with `isPreviewKey`. The device never parses the key suffix (R1). The banner is WP-679.
7. **Device work queued against the old preview config** replans or goes to review like any stale-version run (A-029, L1); nothing special.

## Cost to change later
- Discarding again (V4 reversed) is one call in the `afterDeploy` seam: `dropPreview(projectId)` instead of `carryOver`.
- Known limit: a draft save has already moved a removed option's values to the first remaining option (A-031 item 2) before the admin publishes. The live pick then moves nothing in the preview, because no value is left on the removed option. The preview matches live exactly when it is behind the draft at publish (a saved draft the debounce has not deployed yet). Exactness in every case needs the preview to leave the removed option's values alone until a publish (a `{ discard }` for options on a save), which the preview's own users would see as features on a missing stage. The seam is `previewMappings` (`packages/server/src/preview/mappings.ts`).

## Extensibility (R13)
H1–H6 stay open: the logins are ordinary participants and credentials (a role app or an assistant signs in the same way), the preview flag is one boolean of the bootstrap, and nothing in the preview is domain-specific.
