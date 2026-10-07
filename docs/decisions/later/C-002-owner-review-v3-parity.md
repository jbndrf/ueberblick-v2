# C-002 Owner review 2026-10-01: rebuild the v3 app on the v4 engine
priority: high        status: **owner decision** (not provisional)
date: 2026-10-01   lead: c   touches: every UI, login, stages, lifecycle, deploy, ops

## Context
The owner reviewed the demo of the first build. The engine was rebuilt as asked, but the UI was invented instead of ported from v3, and the app could not be deployed like v3. The full review with every decision: `docs/research/v3-parity/comparison.md` §0 and §10, `register/QUESTIONS.md` (answers), `stages-intent.md`, `tool-platform.md`, `step-1-plan.md`. The mission follows from it: `docs/process/rebuild.md`.

## Decided by the owner
- **Mission:** v3's UI (screens, flows, look, labels) is the spec, ported onto the v4 engine; the v4 UI is replaced.
- **Superseded by this decision:**
  - **A-006** (one-time QR): v3's login stays (reusable admin-chosen or generated tokens, token tab, QR scanner and link, sliding session, info-page variables).
  - **A-024** (refuse value moves on deploy): deploys move values; running features may also stay pinned to their version (Q24, Q25).
  - **Glossary "stage" as any select property / parallel processes:** one process per Objektart with start and end stages; sub-processes are their own Objektart linked by a relation (`stages-intent.md`).
  - **R4 in its old form:** lifecycle (aktiv / abgeschlossen / archiviert / gelöscht) and audit metadata are system-given.
  - **"One home per concept"** (`docs/13`): settings where the work happens plus an overview.
  - **Admin TOTP mandatory:** optional, off by default.
  - **open.md O9:** Docker plus one `.env`, HTTPS `proxy` or `direct` (local self-signed), backup to a local folder.

## Cost to change later
Not provisional; changes need the owner.
