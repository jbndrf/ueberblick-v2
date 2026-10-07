# The v3 journeys (`e2e/journeys`)

The owner's v3 flows as Playwright acceptance tests (WP-945). Each journey describes **v3's behaviour** in v3's routes and German labels (`reference/messages/de.json`); where the owner changed a flow, the header cites the decision. A UI port is done when its journeys turn from `test.fixme` to green (`docs/process/rebuild.md` §4 step 7).

## Run

```
npm run e2e                                         # builds apps/web, runs every suite, journeys included
npm run e2e:journeys                                # builds apps/web, runs the journeys suite only
npx playwright test -c e2e/journeys/playwright.config.ts   # journeys only (build apps/web first; single run)
```

`e2e/journeys` is its own Playwright project with its own port and data directory (`E2E_JOURNEYS_PORT`, `E2E_JOURNEYS_DATA_DIR`, see `docs/process/e2e.md`). The world is the golden tree cadastre: project `musterstadt`, participant "Anna" with the role `kontrolle`, one admin. Helpers are in `e2e/journeys/lib/`: `world.ts` (seed, QR token and link, participant and admin sign-in, server runs), `devices.ts` (two devices), `fixme.ts`, `catalog.ts` (the parser below).

## Writing and turning on a journey

- One `test()` per journey, one spec file per area, steps by **role and accessible name** only (no CSS), German labels from `de.json`, glossary words where the owner renamed a v3 word (Objektart, Objekt, Regel, Aufgabe).
- Header above every journey:
  ```
  // Purpose: <register purpose sentence>
  // v3: <reference file:line of the flow>   Taps in v3: <n>
  // Owner decision: <id, only if the flow differs from v3>
  ```
- Unported journeys are `test.fixme('ID title', waitsFor('<area>'), async ...)`. The suite is green with everything in fixme. When a UI work package ports the screen, it deletes the `fixme` and `waitsFor(...)`, makes the journey pass, and flips the status below. The work package names the journeys it turns green.
- Two journeys are real from the start and are **harness proofs**, not parity: PE-01 (the QR link signs in) and PF-01 (a submitted task reaches the server, through the API because no participant screen matches v3 yet). A ported screen turns its own journeys green (marked `green` in the table below; the WP-324 Teilnehmende page: AP-03, AP-04, AP-05).

## Phone and desktop (WP-950)

Owner rule: **a port is done when its journeys pass in both projects**, `phone` and `desktop`. Every journey runs in both by default (`npm run e2e:journeys`; `-- --project phone` selects one). v3 switches layout at 768 px (`map/+page.svelte:2428`): on a phone a bottom bar plus a draggable bottom sheet, on desktop and tablet header icons plus a 450 px right panel. `phone` is Pixel 7 (touch, mobile, below 768 px), `desktop` is 1280x800.

A step whose place differs per layout asks the one helper, `layout(page)` from `e2e/journeys/lib/layout.ts`, which returns `'phone' | 'desktop'`, and asserts v3's place for that layout:

```ts
import { layout } from './lib/layout';

if (layout(page) === 'phone') await page.getByRole('region', { name: 'Bottom sheet' }).getByRole('button', { name: 'Filter' }).click();
else await page.getByRole('banner').getByRole('button', { name: 'Filter' }).click();
```

No viewport checks in specs outside the helper. `e2e/journeys/layout.spec.ts` proves the two projects' viewports.
Multi-device journeys inherit the project's device: `openDevice` and `twoDevices` in `e2e/journeys/lib/devices.ts` open each context with the project's viewport, isMobile, hasTouch, userAgent and deviceScaleFactor, so both devices share the layout (`e2e/journeys/devices.spec.ts` proves it).

## The check

`scripts/e2e/journeys.spec.ts` (part of `npm test`) parses the specs with `e2e/journeys/lib/catalog.ts` and fails when a journey lacks Purpose, v3 or Taps lines, a fixme lacks its reason, a real test is not a harness proof, or this table differs from the specs (id, area, lane, title, status). Keep the table in step with the files.

## Journeys

Lanes: lead-a is admin, lead-b is participant.

| id | area | lane | title | status |
|---|---|---|---|---|
| PE-01 | participant-entry | lead-b | PE-01 QR link signs in [harness proof] | green |
| PE-02 | participant-entry | lead-b | PE-02 Token tab signs in | fixme |
| PE-03 | participant-entry | lead-b | PE-03 In-app scanner signs in | fixme |
| PE-04 | participant-entry | lead-b | PE-04 Session survives a reload | fixme |
| PE-05 | participant-entry | lead-b | PE-05 Logout keeps unsent changes | fixme |
| PE-06 | participant-entry | lead-b | PE-06 Einstellungen sets theme, font size and language | fixme |
| PE-07 | participant-entry | lead-b | PE-07 Einstellungen: Jetzt synchronisieren shows the sync state | fixme |
| PM-01 | participant-map | lead-b | PM-01 Open the map | fixme |
| PM-02 | participant-map | lead-b | PM-02 Layer switches the basemap | fixme |
| PM-03 | participant-map | lead-b | PM-03 Filter type and stage switches | fixme |
| PM-04 | participant-map | lead-b | PM-04 Filter loads the admin preset for the role | fixme |
| PM-05 | participant-map | lead-b | PM-05 Plus, Objektart, pin, form, Absenden | fixme |
| PM-06 | participant-map | lead-b | PM-06 Draw a polygon with several parts | fixme |
| PM-07 | participant-map | lead-b | PM-07 Zuletzt flies to a feature | fixme |
| PF-01 | participant-feature | lead-b | PF-01 A submitted task reaches the server [harness proof] | green |
| PF-02 | participant-feature | lead-b | PF-02 Open a feature in the peek sheet | fixme |
| PF-03 | participant-feature | lead-b | PF-03 Run a no-field task in one tap | fixme |
| PF-04 | participant-feature | lead-b | PF-04 Run a form task with pages | fixme |
| PF-05 | participant-feature | lead-b | PF-05 Quick edit in Daten | fixme |
| PF-06 | participant-feature | lead-b | PF-06 Photo with Camera | fixme |
| PF-07 | participant-feature | lead-b | PF-07 Aktivität shows who, which task and when | fixme |
| PF-08 | participant-feature | lead-b | PF-08 A refused run: Erneut senden, Verwerfen, Bearbeiten | fixme |
| PF-09 | participant-feature | lead-b | PF-09 An unsent change jumps to its feature | fixme |
| AP-01 | admin-projects-people | lead-a | AP-01 Admin signs in without TOTP and stays signed in 30 days | fixme |
| AP-02 | admin-projects-people | lead-a | AP-02 Projekt erstellen with a Vorlage | fixme |
| AP-03 | admin-projects-people | lead-a | AP-03 Teilnehmende: add a participant with name and roles | green |
| AP-04 | admin-projects-people | lead-a | AP-04 Create a role inline from the participant row | green |
| AP-05 | admin-projects-people | lead-a | AP-05 QR exportieren for a selection, 8 per page | green |
| AP-06 | admin-projects-people | lead-a | AP-06 Rollen: Selbstbeitritt switch and join link | fixme |
| AP-07 | admin-projects-people | lead-a | AP-07 Beziehungen dialog | fixme |
| AS-01 | admin-settings-data | lead-a | AS-01 Kartenebenen preset OSM | fixme |
| AS-02 | admin-settings-data | lead-a | AS-02 Standardansicht saves lat, lng and zoom | fixme |
| AS-03 | admin-settings-data | lead-a | AS-03 Info-Seite with $qrloginlink | fixme |
| AS-04 | admin-settings-data | lead-a | AS-04 Data table: search, sort and filter | fixme |
| AS-05 | admin-settings-data | lead-a | AS-05 Edit mode saves as a run | fixme |
| AS-06 | admin-settings-data | lead-a | AS-06 Row opens the detail with Aktivität | fixme |
| AS-07 | admin-settings-data | lead-a | AS-07 CSV import wizard with preview and replace-all | fixme |
| AB-01 | admin-builder-deploy | lead-a | AB-01 Builder: add stage | fixme |
| AB-02 | admin-builder-deploy | lead-a | AB-02 Builder: add a task button and drag its dot to a stage | fixme |
| AB-03 | admin-builder-deploy | lead-a | AB-03 Form editor: add a page and a property | fixme |
| AB-04 | admin-builder-deploy | lead-a | AB-04 Roles on the property | fixme |
| AB-05 | admin-builder-deploy | lead-a | AB-05 Permission matrix shows the same | fixme |
| AB-06 | admin-builder-deploy | lead-a | AB-06 Add a Regel with a trigger | fixme |
| AB-07 | admin-builder-deploy | lead-a | AB-07 Preview with demo data and a preview login | fixme |
| AB-08 | admin-builder-deploy | lead-a | AB-08 Deploy overview: removed stage, verschieben nach, features moved | fixme |
| AB-09 | admin-builder-deploy | lead-a | AB-09 Versionen: rollback | fixme |
