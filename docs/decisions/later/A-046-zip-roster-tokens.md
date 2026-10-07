# A-046 The project ZIP carries the roster with the login tokens (owner answer A7)
priority: medium        status: provisional
date: 2026-10-03   lead: a   work packages: WP-432   touches: H3, R3, R13

## Context
Owner answer A7 (2026-10-03, `register/QUESTIONS.md`): "Gesamtes Projekt exportieren (ZIP)" includes everything, as in v3 (`includeParticipants: true`): the roster **including the login tokens**, so existing logins keep working on the new instance. Until WP-384 the archive held the project file, the folded features and the blobs, no participants. The server stores a login token readable (C-002, WP-607) and unique in the **whole instance** (`credentials.token` is the primary key; `tokenExists` in `auth/service.ts`).

## Options
- A) Add the roster as two new entries and import it through the roster's own functions (chosen).
- B) Hash the tokens in the archive. Rejected: the server cannot sign in from a hash it never stored, and a hash would add storage for a thing that is stored readable anyway.
- C) Leave participants out and re-issue tokens. Rejected by the owner (A7).

## Chosen (provisional)
A. Format version 2 (`archive/manifest.ts`; an archive of version 1 has no roster and imports as before):
- `manifest.json` gains the optional `roster: { participants, columns }` (counts; absent: no roster).
- `roster/columns.json`: the custom columns of the Teilnehmende table, `[{ key, label, type, default?, required? }]`.
- `roster/participants.ndjson`: one participant per line, `{ id, name, email, phone, roles, attrs, selfJoined, createdAt, disabledAt, hidden, login }`. `login` is `{ token, expiresAt }` (the current token as the server stores it, an expired one included) or `null` (none, or the participant was removed). Admin accounts and memberships are **not** in the file (admins are instance accounts).

Export reads the `participants` and `participant_columns` tables and asks `Auth.currentCredential` for each token. Import reads and checks the roster **before the project is created**, then restores it right after, through the same server functions as the Teilnehmende page (R1, `importParticipant`, `setColumns`, `removeParticipant`, `disableParticipant`, `Auth.replaceCredential`), never a table insert. Participants keep their ids, so the actor of an imported feature's creator stays known. A removed participant is hidden again, a disabled one is disabled (its token works after the admin enables them).

Collisions (changed by the lead, provisional, after the first build refused them): the token scope is the instance, so importing a project as a copy on the same instance collides on every token. The import therefore does **not** refuse: a participant whose token is already in use (`Auth.tokensInUse`, revoked ones count) gets a **fresh token** from the same function the Teilnehmende page uses (`Auth.replaceCredential` without a chosen token), keeping the expiry; all other tokens are kept. The result names the count (`renewedTokens`; "n Teilnehmende haben neue Zugangslinks erhalten", shown in the import dialog and the toast). The original project's logins are untouched. A token twice **inside** the archive is a corrupt archive: the whole import is refused with the typed problem `token_duplicate`, nothing is created. No message names a token or a person.

The file is **sensitive**: it holds login credentials. The ⋮ menu item says so in a tooltip, the success toast after the export says so, and docs/03 and the user docs say so.

## Cost to change later
now: two archive entries, one optional manifest field, one `Auth` method (`tokensInUse`). The archive can later be encrypted (idea, not built) without changing the entries. Seam (R13, H3 role apps): per-role settings that live in the roster tables travel through the same two entries; a later column type is a registry entry. Not carried: `createdAt` of a guest (a restored guest gets a new join time, so the 90 day guest expiry starts again), and the last-used time of a token.
