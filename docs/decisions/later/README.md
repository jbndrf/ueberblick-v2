# Later topics: provisional decisions for the owner to review

The build runs autonomously (`docs/process/lead-loop.md`). Anything that would normally go to the owner is decided **provisionally** by a lead and recorded here: one file per topic, with the lead's letter as a prefix (`A-001-parser-choice.md`, `B-004-3d-renderer.md`). After the build, the owner goes through them, ranked by priority, in `docs/process/final-report.md`. An accepted topic becomes a normal decision record, and a rejected one becomes a work package.

Rules for provisional choices, in this order:
1. Take the default in `docs/decisions/open.md` if there is one.
2. Otherwise take the option that is **cheapest to undo**.
3. Keep a **seam**: a port, registry entry or interface, so that the alternative can be added without a rewrite.
4. Never lock in something that blocks H1–H6 (`docs/11-future-capabilities.md`). If every option does, pick the least bad one, mark the topic **high**, and isolate the choice behind the seam.

## Template

```markdown
# A-001 <topic in one line>
priority: high | medium | low        status: provisional
date: YYYY-MM-DD   lead: a | b   work packages: WP-…   touches: H1…H6 / O1…O15 / R13–R15 / budget

## Context
2–4 lines: what forced the decision.

## Options
- A) … consequence
- B) … consequence

## Chosen (provisional)
X, because … The seam that keeps the others possible: `path/to/port.ts`.

## Cost to change later
now: … · after the build: … (files, data migration, API change)
```

## Index

Kept by lead-c. High first, then medium, then low.

| id | priority | topic |
|---|---|---|
| [C-004](C-004-one-action-person-or-automatic.md) | high | One action: one condition, one outcome, carried out by people (`who`) or automatically (`auto`); rules folded into tasks (owner proposal, 2026-10-05) |
| [A-002](A-002-project-file-schema-v1.md) | high | Project file schema v1: key choices (O11) |
| [A-004](A-004-schema-v1-gaps-from-corpus.md) | high | Schema v1 gaps found by the golden corpus |
| [A-050](A-050-unhide-in-catalog.md) | low | Hidden template elements are listed greyed in the catalog with "Einblenden" (WP-452) |
| [A-005](A-005-course-check-001-decisions.md) | high | Key paths, stored compiled config, reserved words, sync forward-compat (course check 001) |
| [A-009](A-009-actor-roles-and-task-audience.md) | high | `actor.roles` only (no `actor.role`); task audience stays CEL for now |
| [B-003](B-003-3d-stack.md) | high | 3D stack: OGC 3D Tiles + MapLibre custom layer with three.js (O13) |
| [B-005](B-005-gdpr-erasure-redaction-first.md) | high | GDPR erasure: redaction runs first, crypto-shredding kept as a seam |
| [B-006](B-006-perms-actor-kinds.md) | high | Role allowlists bind participants only; admin, system and rule runs are not role-filtered |
| [A-001](A-001-sqlite-driver.md) | medium | Server SQLite driver: better-sqlite3 behind a `Db` interface |
| [A-003](A-003-rule-language-parser.md) | medium | Rule-language parser: hand-written subset parser (O2) |
| [A-006](A-006-qr-login-one-time.md) | medium | *(superseded by C-002, owner 2026-10-01)* QR login tokens are one-time (no reusable badges) |
| [A-008](A-008-admin-authorization.md) | medium | Admin API authorization: any project membership, templates published by any admin |
| [A-011](A-011-builder-draft-store.md) | medium | Builder drafts: one shared draft per project, compare-and-swap on a revision |
| [A-012](A-012-expr-evaluate-60k-budget.md) | medium | Full rule evaluation over 60k features: budget derived from delta-visible, not long-task |
| [A-013](A-013-template-publish-authorization.md) | medium | Template publishing: any project admin may publish (templates are global) |
| [A-014](A-014-unknown-participant-roles.md) | medium | ~~A participant with no roster row gets no roles (not 401)~~ superseded by A-025 |
| [A-017](A-017-ogc-write-task-mapping.md) | medium | OGC API writes: which task a write runs, and DELETE |
| [A-018](A-018-mcp-apply-confirmation.md) | medium | MCP `apply` confirmation: same-origin human step now, a separate assistant credential later |
| [A-019](A-019-erasure-admin-path.md) | medium | ~~Erasure runs through an admin store path until the rule-driven `redact` step exists~~ superseded by A-021 |
| [A-021](A-021-erasure-as-ordinary-run.md) | medium | Erasure is an ordinary run of a `redact` task; the admin erasure path is removed |
| [A-022](A-022-erasure-replay-actor.md) | high | Backup restore replays erasures as an admin restore actor |
| [A-023](A-023-erasure-permission-admin-equality.md) | high | Erasure permission and restore replay are coupled to "all admins are equal" |
| [A-024](A-024-deploy-mappings-refuse-value-moves.md) | medium | *(superseded by C-002, owner 2026-10-01)* Breaking deploys that need value moves are refused until mappings execute |
| [A-025](A-025-unknown-participant-refused.md) | medium | A participant with no roster row is refused (401) |
| [A-026](A-026-qr-image-library.md) | low | QR login codes are drawn by a small MIT QR encoder, lazy-loaded in the participants lens |
| [A-027](A-027-admin-totp-enrolment.md) | medium | First-time admin TOTP enrolment stays an operator CLI step (revisit with OIDC) |
| [B-001](B-001-ui-primitives-scoped-css.md) | medium | UI primitives use scoped CSS on token variables, not Tailwind/bits-ui |
| [B-004](B-004-device-facts-in-memory-mirror.md) | medium | Device Facts: synchronous in-memory mirror over IndexedDB, history warmed on demand |
| [B-007](B-007-map-load-budgets.md) | medium | Map load budgets: renderer init measured apart from feature delivery; 60k cluster build 1500 ms (×4) |
| [B-008](B-008-panzoom-software-gl.md) | medium | Pan/zoom long-task row: median under software GL, real GPU authoritative |
| [B-009](B-009-primary-geometry-vs-index.md) | medium | The declared primary geometry is the map geometry; the spatial index covers every geometry property |
| [B-010](B-010-node-bench-warmup-page.md) | medium | Node long-task benches exclude one JIT warm-up page; cold start is judged in the browser bench |
| [B-012](B-012-device-sync-in-worker.md) | medium | The device sync pipeline (pull, plan, IndexedDB writes) runs in a dedicated Web Worker |
| [B-013](B-013-self-contained-stored-config.md) | medium | A stored project file is self-contained: `$ref` assets are embedded once, at ingestion |
| [B-014](B-014-feature-display-name.md) | medium | A feature's display name is its first required text property |
| [C-001](C-001-docsync-keep-or-stop.md) | medium | docsync stays on probation: stop it if its edit-or-reject share stays above 50% |
| [C-003](C-003-direct-https-own-tls-front.md) | medium | Direct HTTPS mode uses the app's own TLS front, not a Caddy container |
| [B-016](B-016-guest-creation-roster-write.md) | medium | Guest self-join creates the participant by a system roster write, not a run |
| [B-017](B-017-offline-pack-file.md) | medium | Offline pack file: v3's single-file `.ubpack` container, on the device |
| [B-019](B-019-child-at-parent-position.md) | medium | A child at its parent's position: drawn at the parent's anchor, no copied geometry |
| [C-002](C-002-owner-review-v3-parity.md) | high | **Owner decision:** rebuild the v3 app on the v4 engine; supersedes A-006, A-024, the stage-as-any-select model, mandatory TOTP; decides O9 |
| [A-028](A-028-process-and-lifecycle-shapes.md) | high | Shapes for the owner's concepts: `types.<t>.process`, `$lifecycle` replaces `$deleted`, `$created_by` plus fold times, `$move` system runs |
| [A-029](A-029-version-pinning-design.md) | high | Version pinning design (Q25): `$version` pin, floating default, plan config resolver, per-version sync predicates; owner answered P1–P4 on 2026-10-02 (QUESTIONS.md) |
| [A-032](A-032-offline-pack-contract.md) | high | Offline packs: definition in `map.packs` (config), content-hashed server build, one PMTiles per pack and layer, manifest + Range download; device side lead-b WP-662; owner P5 answered 2026-10-02: tiles through the ported v3 tile proxy (lead-a WP-369, A-033) |
| [A-033](A-033-tile-proxy.md) | high | Tile proxy: `/api/p/<project>/tiles` and `/wms` serve map tiles from a disk cache so browsers never reach a provider; packs of xyz and preset layers warm the same cache; OSM packs capped at 10,000 tiles; owner P5 answered |
| [A-030](A-030-admin-port-lead-decisions.md) | low | Small placement decisions for the v3 admin port (Aktiv/Inaktiv dropped, Tabellen criterion, quota via draft, simple publish confirm) |
| [A-035](A-035-then-step-of.md) | medium | Then-steps act on other features: optional `of` on `lifecycle` and `set` (relation couplings are visible task steps), capped by `THEN_STEP_TARGETS_MAX` |
| [A-038](A-038-property-changed-at.md) | medium | `changed_at('prop')`: the time a property last changed, read from the history port (no new fold state); for "seit Eintritt in Phase" rules |
| [A-040](A-040-start-visible-types.md) | low | Erststart 'Sichtbare Objektarten': `types.<t>.on_at_start` and `types.<t>.values_at_start` in the project file; core `startFilter(file)` gives the participant filter's start state; 'Alle' is derived, not stored |
| [A-042](A-042-order-is-a-change.md) | medium | An order change (properties, form fields, options, tasks, layers) is a change: it is in the deploy diff and the config hash |
| [A-036](A-036-branding-and-map-bounds.md) | low | Branding (`branding.name`, `branding.icon` as a blob sha) and `map.min_zoom` / `map.max_zoom` are project-file config; admin-only icon upload, config-referenced blob readable by participants |
| [A-043](A-043-ogc-participant-writes.md) | medium | OGC Part 4 writes run as the caller: a participant token or session writes under the participant's own permissions (core `plan`), refusals for permission are 403; admins unchanged |
| [A-037](A-037-api-tokens-project-delete.md) | medium | API tokens (QGIS / GIS, Q18) are a second hashed table with the same participant principal; project delete by membership with the typed key, the key is retired for good |
| [A-046](A-046-zip-roster-tokens.md) | medium | The project ZIP (format version 2) carries the roster with the login tokens as stored (owner A7): `roster/columns.json`, `roster/participants.ndjson`; import restores through the roster functions, a token already used on the instance gets a fresh one for that participant (count reported), a token twice inside the archive refuses the import (`token_duplicate`); the file is sensitive |
| [A-052](A-052-multiple-of.md) | low | Rule-language function `multiple_of(value, step)` checks a decimal step exactly; the field panel's 'Schritt' covers decimal numbers |
| [A-045](A-045-rule-edge-trigger.md) | medium | Rule trigger `{ when: <expr> }` fires on false → true of a touched feature, judged on the state before and after the run (no stored flag, re-arms by itself); clock-only conditions stay with `elapsed` |
| [A-049](A-049-layout-per-form.md) | medium | Layout per form: `column` and `row` on each form entry (`tasks.<t>.form.<key>`), the form's own; the property's `display.column/row` stays the Daten view's; existing golden forms copied once, no fallback |
| [A-047](A-047-form-fields-of-bound-objekte.md) | medium | A task form may show and edit a property of a bound Objekt: form key `<bind>.<property>`, prefilled and validated from the bound value, written to that Objekt in the same run (`readonly` is the switch; a missing Objekt makes the field not relevant) |
| [A-051](A-051-role-property-type.md) | low | Entity selector: Rollen as a source is a `role` property type (a role key of the file, one or many; plan refuses an undeclared key) |
| [A-048](A-048-entity-selector-multi-and-display-field.md) | medium | Entity selector: Mehrfachauswahl is `cardinality: many` on a reference or participant property, Anzeigefeld is `display_property` on a reference (via `displayName`); many back to one is `type_changed` (breaking) and refused in the builder while the template declares many |
| [A-053](A-053-task-bind-editor.md) | low | The task pane's Definition tab edits a task's `bind` ("Verknüpfte Objekte": name → one-relation of the subject, remove/rename refused while form entries use it) |
| [A-054](A-054-idle-sweep-on-schedule.md) | medium | A scheduled rule can be a sweep: `idle` on `{ schedule }` visits each Objekt of the Objektart, bounded batches with a cursor (WP-469, A10 b) |
| [A-055](A-055-role-property-select.md) | low | `role` properties take the participant `select: { all, self }` ("Nur Selbstauswahl" / "Kann jeden auswählen"); plan refuses a disallowed role pick (WP-481, extends A-051) |
| [A-044](A-044-tile-upload.md) | medium | Tile upload: chunked ZIP / MBTiles / PMTiles upload, converted in-process to one PMTiles archive per upload, served by range under a project-scoped URL; layer entry written by the admin tab (WP-406) |
| [A-031](A-031-preview-environment.md) | high | Preview environment: a second DB per project (`<key>__vorschau`), draft deployed on save, generated demo data, preview logins, discarded on deploy (item 5 superseded by A-034); owner answered V1–V4 on 2026-10-02 (QUESTIONS.md) |
| [A-034](A-034-preview-carry-over.md) | high | Preview carry-over (supersedes A-031 item 5, owner V1–V4): the preview is not discarded on a deploy, its data moves with the live deploy's value moves, preview logins per role keep their tokens, `project.preview` on the bootstrap |
| [B-015](B-015-v3-design-system.md) | high | v3's design system (Tailwind 4 + bits-ui/shadcn-svelte) replaces the scoped-CSS primitives |
| [B-018](B-018-classifying-property.md) | high | The classifying property per type: v3's per-value icons and colours (gap G1) |
| [A-007](A-007-effect-registry-location.md) | low | Outbox effect registry lives in the server for now |
| [A-010](A-010-project-creation-operator-cli.md) | low | Projects and admin accounts are created by the server operator via CLI only |
| [A-015](A-015-ever-visible-relation-limit.md) | low | Sync tombstones and relation-dependent `visible_when`: replay reads relations as they are now |
| [A-016](A-016-rule-trace-trigger.md) | low | Rule trace entries name their trigger (run or timer), not an optional causedBy |
| [A-020](A-020-observations-by-actor-scan.md) | low | `Facts.observationsByActor` scans observations; no `observations(run_id)` index yet |
| [A-041](A-041-tool-removal-not-breaking.md) | low | Removing or changing a `tools.<key>` is not a breaking change |
| [B-029](B-029-hook-fault-answer.md) | low | A transaction hook that throws: named 500 (`hook_<name>`), busy stays 503, the run is rolled back, never refused |
| [B-002](B-002-geometry-engine-jsts.md) | low | Geometry predicate engine: JSTS (O6) |
| [B-011](B-011-wcag-level.md) | low | Conformance claim: WCAG 2.1 AA (BITV 2.0 / EN 301 549); WCAG 2.2 AA stays the design goal |
