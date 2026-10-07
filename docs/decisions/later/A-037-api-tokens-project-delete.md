# A-037 API tokens (QGIS / GIS access) are a second, hashed token table; project delete retires the key
priority: medium        status: provisional
date: 2026-10-02   lead: a   work packages: WP-388   touches: H4, H6, R1, R13

## Context
Owner Q18: QGIS gets full access for anything the user may do, with a token that an admin creates per participant. v3 had `api_tokens` (`ubk_` token, hashed, label, last four, expiry, last used, `can_write`) and a project delete in the danger zone. v4 has the participant login token (WP-606/607) and no delete.

## Options
- A) **Reuse the login token** (`credentials`). One kind (R1). But the login token is stored readable (C-002), there is one current token per participant (a new one revokes the others), and the admin reads it in the roster. Q18 needs many per participant, a label and a last use, and the secret must not be readable later.
- B) **A second table `api_tokens`** (hashed, many per participant, label, last four, expiry, last use, revoke). `authenticate` resolves it to the same participant principal a session gives, so there is still one auth path and one permission check.

## Chosen (provisional)
B. The token is `ubk_` + 43 URL-safe characters (256 bits), only its SHA-256 is stored, and the secret is shown once when it is created. A request carries it as `Authorization: Bearer <token>` or HTTP Basic (QGIS: the token as user name, or as password). `readSessionCookie` returns the cookie's session id, else `api:<token>` from the header, so every project endpoint accepts a token without a second code path; `exchange` refuses it (a token is no login) and a participant revoke, a disabled participant and an expiry stop it at once.
- **Seam (H4):** `api_tokens.scope` with the registry `API_TOKEN_SCOPES` (one entry, `full`). A narrower token for an assistant is one more entry and a check where the scope is read; the table does not change.
- **Open (admins):** Q18 also names admins. An admin account has no participant row, so an admin token needs its own principal; today an admin signs QGIS in with the session cookie (`connect-qgis`). Not built, parked in the WP-388 Notes.
- **Writes:** opened to participants by A-043 (WP-402): a token writes as the participant, under their permissions.
- **Project delete:** `DELETE /api/admin/projects/<project>` with `{ "confirm": "<project key>" }` removes the project database (+ wal, shm), blobs, offline packs, tile cache, the preview (database, blobs, logins) and every control row (project, memberships, logins, API tokens, sessions, join links, preview). Who may: any project membership, as v3 and A-008 (memberships only ever hold the role `admin`; there is no owner role). 401 anonymous, 403 participant or non-member, 404 unknown project. Seam: `authorizeProjectDelete` in `admin-project-delete.ts`, where an owner role would go.
- **The key is retired:** `retired_projects` keeps the key of a deleted project, `freeKey` skips it and a trigger on `projects` refuses an insert. Per-key caches in the running process (sync, doorbell, timers, packs, stores) would otherwise serve a new project with the same key from the deleted one's closed database. Cost: that key is never reused.
- **Orphan files:** if the file removal fails after the control rows are gone, the files stay (a retry answers 404). `removeProjectFiles` (the one function the delete uses) runs again at every runtime start for each key in `retired_projects` (WP-404): project database (+ wal, shm, journal), blobs, packs, tile cache, the preview's database and blobs. It is idempotent and O(retired keys); a failure is logged (`blob.delete_failed`) and does not stop the start. Only retired keys are swept: an unknown file may belong to an import in progress, so it is never touched. Nobody removes files by hand.
- **Left until restart:** the in-memory services of the deleted key (sync, doorbell, timers, pack slots) stay until the process restarts; nothing reaches them again.

## Cost to change later
low for the token table (additive; merging it into `credentials` is a migration plus one lookup), low for the owner role (one function). The retired key list is additive.

## Addendum (WP-424)
- A ZIP import that fails after it created the project removes it through `deleteProject` (no second removal path); a failing removal leaves the files to the startup sweep ('Orphan files'). `removeProjectFiles` also removes `blobs/tiles/<key>` (uploaded tile archives, A-044); the Runtime has `tilesDir(key)` next to `packsDir`.
- Reserved project keys (`RESERVED_PROJECT_KEYS`: `tiles`, `packs`): skipped by `freeKey`, refused by `assertProjectKey` and by `removeProjectFiles` (which deletes nothing for them), because `blobs/tiles` and `blobs/packs` belong to every project. A failed ZIP import's key is retired by the delete and never reused.
