# The rebuild: the owner's app on the v4 engine

**Owner instruction, 2026-10-01. This file overrides anything older that contradicts it.** Every lead reads it in full at every start and after every compaction. Every implementer and reviewer reads it before its work package.

## 1. What went wrong, and what we do now

The first build rebuilt the **engine** the owner asked for: runs and observations, one fold, the rule language, permissions, offline sync with live updates, templates and deploy. That engine is good and stays.

But the build also **invented a new app on top of it**: new screens, new navigation, a new login, a "builder IDE" with lenses, features nobody asked for. It never rebuilt the owner's v3 app, whose UI worked, was pleasant and made sense. It also cannot be deployed the way v3 was.

**The mission now: rebuild the owner's v3 app on the v4 engine.** Users should find their app again: the same screens, flows and ideas, improved only where the new engine requires or enables it, and with v3's known bugs fixed.

## 2. Sources of truth, in this order

1. **Owner decisions:**
   - `docs/research/v3-parity/comparison.md` §0 (principles) and §10 (decisions)
   - `register/QUESTIONS.md` (answers)
   - `stages-intent.md`, `tool-platform.md`, `step-1-plan.md`
2. **v3's code** (`reference/`, read-only): what each element did and **why**.
3. **The placement register** (`docs/research/v3-parity/register/*.md`): one row per v3 element with purpose, flow, v4 concept and a proposed placement. Proposals are not decisions, so check them against 1 and 2.
4. The v4 engine docs (`docs/01`–`docs/12`), for how the engine works.
5. The current v4 UI (`apps/web` participant shell, `packages/builder` lenses, `/builder`, `/app`) is **not a target**. It gets replaced. Only headless parts are reused (see §6).

## 3. How to work: freedom with judgment

You are expected to **think**, not to follow rules mechanically. For every element you touch, answer the owner's core question first:

> "This element let the user **do XYZ** (in this situation). In the new app the user does XYZ **here** (and **there**), because …"

Write that sentence into your work package's Log for each element.

### The owner's principles (from the review, 2026-10-01)
- **Purpose first.** An element whose purpose is still served is moved, never dropped.
- **Settings sit where the work happens, plus an overview for bulk work.**
  - Configuring workflows is the admin's job: while building a form, they set which roles see or edit a property right there, on that property.
  - The permission matrix is the overview for bulk changes.
  - Two places for one setting are intended when they serve two purposes.
  - "Field" means a form field or property, never a field worker.
- **The device shows what is on the device.** Every element computes what it shows from the data synced to the device, as v3's Aktivität tab did from the local log. An element never fetches on its own. If data is missing, fix the **sync**.
- **The core map is plain:** Filter, Layer, Standort, +, Werkzeuge, Einstellungen. Extras are opt-in tools (`tool-platform.md`): the admin offers them per role, and each person switches them on.
- **One process per Objektart** (stages, as in v3). A sub-process is its own Objektart, linked by a relation. Tasks may work across Objektarten by condition. The lifecycle (aktiv / abgeschlossen / archiviert / gelöscht) and audit metadata (created by / at, last changed) are system-given. Everything people put on the map is configurable.
- **Deploying changed templates without fighting existing data is the core feature.** The preview is v3's draft with demo data and preview logins, discarded on deploy.
- **No inventions.** No new screens, features, menus or settings beyond v3 and the owner's decisions, unless the engine *requires* a new setting. Ideas go to the work package's Notes, never into code.

### You decide yourself, and write down why (in the Log)
- Where an element sits, when v3's flow makes it clear. The default is v3's place.
- How to structure components and code. Splitting v3's big files to fit 400 lines is required.
- Placing an engine-required setting next to where the admin already works on that thing.
- Fixing v3 bugs listed in the register (wrong behaviour, English strings in German UI, dead links).
- Small deviations from v3 the new engine forces, e.g. a stage is a property option, every change is a run.

### You stop and ask (implementer → lead; lead → owner list)
- A new screen, feature, menu or setting that neither v3 nor an owner decision has.
- Dropping an element's purpose, or moving something to a place its users would not look for.
- Anything that contradicts an owner decision, or a v3 flow that the engine cannot support as is.
- Two equally good placements with different consequences for the user.

**How to ask:**
- Implementers write the question into the work package's Notes and report it to the lead.
- The lead decides only if the answer is small and cheap to undo, and logs it.
- Otherwise the lead adds it to the section "Open for owner" in `docs/research/v3-parity/register/QUESTIONS.md`, as a concrete choice with options, a short explanation of each, and the recommendation first. The lead parks that element and continues with other work. **Never invent an answer for the owner.**

## 4. How to port a v3 element
1. **Read v3's code** for it (route, component, state, server action). Cite file:line in the Log. Don't work from screenshots or memory.
2. **Write the purpose sentence** (§3).
3. **Map it to the engine**, using the register row for that element. If the engine lacks something, that is an engine work package, not a workaround in the UI.
4. **Port the UI code.**
   - Copying and adapting v3's Svelte (v3 is Svelte 5 too) is **allowed and expected**, as are its layout, interactions and visual design.
   - **Not ported:** v3's data layer (PocketBase gateway, `participant-state` stores, `pb_hooks`, client/server twins). Data comes from the v4 client readers (device) or the v4 server.
5. **Labels.** Take German labels from `reference/messages/de.json`. The renamed concepts use the glossary words the owner chose: Objektart, Objekt, Regel, Aufgabe. Every string goes into a Paraglide catalogue with a real English translation (v3 left English in German).
6. **Visual design.** v3's look is the target. Bring v3's components and styling into `packages/ui` as the design system instead of re-styling them. If that conflicts with an existing `packages/ui` component, v3 wins.
7. **Tests replay v3's journey** for the element: what the user does and what they must see, plus the engine behaviour. Use e2e where a real browser matters.
8. **Replace, don't keep both.** When a ported screen lands, delete the v4 screen it replaces (R11: no shims).

## 5. Steps, lanes and checkpoints

| Step | Content | Lane |
|---|---|---|
| 1 | Run it like v3: Docker, one `.env`, HTTPS `proxy` / `direct`, security headers, first admin from `.env`, TOTP optional, backup (`step-1-plan.md`) | lead-c |
| 2 | Participant core: v3 login (§10.21), `/` → `/login` → `/map`, map with layers and basemaps, bottom bar, + picker and pin on the map, drawing on the map (multi-part), feature sheet (peek, Aktivität, Daten, quick edit, multi-step tasks), forms with pages, photos end to end, filter sheet, settings, offline start | lead-b |
| 3 | Admin core: v3 sidebar and pages (projects with template, participants with QR PDF, roles with self-join, relations, project settings, data table and detail, CSV/GeoJSON import as runs) | lead-a |
| 4 | Workflow builder and deploy: v3 canvas (one process per Objektart, sub-process links), task tabs, form editor, rules, permission matrix plus in-context roles, Code view, deploy overview with value moves, Versionen, preview with demo data | lead-a |
| 5 | The rest: chat, consent and legal pages, offline packs (PMTiles), info pages with variables, GIS tokens, project delete, opt-in tools, personal preferences | lead-b (participant side), lead-a (admin side) |

### Engine gaps, owned by the lane whose step needs them first

**lead-a:**
- the process and stage model with start and end stages
- the system lifecycle and system metadata (`stages-intent.md`, Q23)
- value moves on deploy (supersedes A-024)
- version pinning (Q25)
- "Berechnet" as a property setting (Q29)
- a delete effect
- import as runs
- project creation from a template, and "Als Vorlage veröffentlichen"
- deploy affected counts
- the preview environment
- server-side paged, sorted and searchable admin lists
- GIS tokens with full access (Q18)

**lead-b:**
- v3 login: reusable tokens, sliding session, token tab, QR scanner and link, takeover, info-page variables, consent gate, guest self-join with quota and expiry 90 days after joining
- run details in the sync (Aktivität)
- blobs: upload, serving, thumbnails, several files per property, offline photos
- service worker and PWA
- layers, basemaps and PMTiles
- the personal preference store
- tool platform v2
- role filter presets and personal filters
- quick edit and multi-step tasks, and task button colour, icon and confirmation in the task schema
- three date modes (Q8)

**lead-c:**
- step 1
- the two-device live-sync e2e (one device changes, the other sees it on the map within seconds)
- the journey-test harness that replays v3 flows
- the checkpoint pages and the demo

When a gap is needed by both lanes, the first lane writes the contract and lands it before the other lane builds on it. Agree in the journals.

### Checkpoints (owner decision: overnight runs with checkpoints)
A lead works through its step without waiting. When the step's scope is done:
1. lead-c brings up a live demo of main.
2. The lead writes `docs/research/v3-parity/checkpoints/step-<n>.md`. For every register element of the step, it gives the purpose sentence, where the element lives now, deviations from v3 with their reason, and the open questions.
3. The lead adds one line to `metrics/raw/needs-owner.md`: "CHECKPOINT step <n> ready".
4. **Until the owner approves,** the lead does not start the next step's UI work packages. It continues with engine gaps, contracts, tests and refinement for the next step, which are safe either way.

### Work packages
- Use the template (`work-package-template.md`) with two extra sections: **"v3 source"** (routes and components with paths) and **"Elements"** (the register rows it covers, each with its purpose sentence).
- Refine one step at a time. About one day of work each, distinct `owns:`.
- Reviewers check, besides the usual: the purpose sentences, v3 parity of flow and placement, deviations explained, no inventions, device-data rule.

## 6. What stays from the v4 build

**Engine:**
- `packages/core` (except the stage and lifecycle model, which changes per `stages-intent.md`)
- `packages/server`, `packages/client` (sync, queue, store)
- deploy and versions, OGC

**Headless pieces under the new UI:**
- `packages/builder/src/doc` (document editing with provenance)
- `packages/builder/src/simulate` (as the engine of the preview)
- the tool host and `defineTool`
- form logic (`packages/ui/src/form/model.ts`)

**Replaced:**
- the `/app` shell and its view chips
- the lens builder and `/builder` routes
- the start page

**Deleted** once their v3 replacement lands.
