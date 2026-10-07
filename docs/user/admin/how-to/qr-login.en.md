# Issue and revoke QR logins

Each participant signs in with a personal QR code. A participant must be on the project's **roster** first: the roster holds the participant's name, roles, optional contact data and an id that the system generates, and the roles decide which tasks the participant may run. Someone who is not on the roster cannot sign in: the QR code is refused.

## On the command line

Run these on the server (`npm run admin -- ...`):

- **Add to the roster:** `participant add <project> <name> [role1,role2]` (the name is required; the id is generated from it and printed, for example `anna-3fa9c1`). Roles must exist in the project.
- **Change roles:** `participant roles <project> <id> <role1,role2>` (applies at the next request)
- **List:** `participant list <project>` shows the roster and how many QR codes are active.
- **Issue a QR code:** `participant qr <project> <id> [expiry]` prints the code's token once. The token is reusable (on any device) and, without an expiry, never expires; only revoking blocks it. Turn the token into the QR code; it cannot be shown again.
- **Revoke:** `participant revoke <project> <id>` blocks all of the person's codes and signs their devices out at once.
- **Switch off / on:** `participant disable <project> <id>` refuses the person's sign-in and codes until `participant enable <project> <id>`. The codes themselves stay valid and work again afterwards.
- **Remove:** `participant remove <project> <id>` revokes all codes, signs the person out and hides them from the list. The person stays in the history of their work.

## On the Participants page

The **Participants** page (sidebar, under the project) does all of this without commands: add a person, copy the login link, print QR badges, switch someone off. See [Manage participants](participants.en.md).

## Through the admin interface

The same functions are available at `/api/admin/p/<project>/participants` for signed-in admins of the project (details in `docs/04-data-model.md`). Changes must come from the admin app itself (same origin).

## Roster data

- **Name** is required (an empty name is refused).
- **E-Mail** (must contain `@`) and **Telefon** are optional. They are personal data and are part of the export of a person's data.
- **Roles** are checked against the roles of the deployed configuration and of the builder draft. A role you just added in the builder can be assigned at once; an unknown role is refused with a message in English and German.
- **Own columns:** per project you can define extra columns (key, label, type text, number, boolean or date, default value, required) at `GET/PUT /api/admin/p/<project>/participants/columns`. Their values are stored with the participant. A required column must have a value when a person is added or changed; a default value is filled in when a person is added without one.
- **Guests:** people who joined by themselves are marked. The list hides them unless you ask for `?guests=true`.
- Roster changes apply at once; they are not part of the builder draft.

API summary (all for admins of the project, changes from the admin app):

- `POST participants` with `{ name, email?, phone?, roles?, attrs? }` returns `{ id }`.
- `PATCH participants/<id>` with any of `{ name, email, phone, roles, attrs, disabled }`; `disabled: true` or `false` switches the person off or on.
- `DELETE participants/<id>` removes (hides) the person.
- A refusal is `{ error: <code>, message: { en, de } }`.

## Rules

- **Reusable:** the code works again and again, on every device, until it expires or is revoked. The sign-in lasts 90 days and is extended every time it is used.
- The token itself is stored, unique in the whole installation. The list of codes never shows the token.
- If you migrate from v3, the roster is filled from the v3 users (ids and roles). You still issue each QR code yourself.
- **Admins** sign in with e-mail and password (at least 10 characters); the one-time code (TOTP) comes in only with `ADMIN_TOTP=on` (see [Sign in](sign-in.en.md)). The session ends after 12 hours or, with the "Stay signed in for 30 days" tick, after 30 days.

## Guests: joining through a public link

A role can admit guests, for example for a defect reporter: whoever opens the public link `/join/<slug>` is created as a participant with that role (the page optionally asks for "Your name"; empty gives `Gast`), signed in, and lands on the map. No QR code per person is needed.

- **Switching on and off** applies at once and is not part of the draft. Through the admin API: `PUT /api/admin/p/<project>/roles/<role>/self-join` with `{ "enabled": true, "slug": "maengel-nord" }`, the list at `GET /api/admin/p/<project>/roles/self-join`. Without a `slug` a random one is given (3 to 64 characters: lowercase letters, digits, hyphen, but not at the start; unique across the installation). Changing the slug ends the old link at once.
- **Opening the link creates nothing**, not even in a link preview. Only the page itself submits the join. An unknown or switched-off link shows "Not found."
- **Handing access back:** when a guest loses their access, switch on "Show guests" on the participants page, find the name in the table and show or copy the login link / QR code (or generate a new key). The guest stays the same participant, so their sponsorships and reports stay theirs. Explain this to guests yourself, for example on an info page.
- **Already a guest:** when a device that already has a guest of this project signed in opens the link again, the same guest is signed in again and no second one is created.
- **Limit:** with `quota` on the role in the project file (`roles.<role>.quota`, a number) a person may create at most that many objects. It applies to everyone with the role; the server refuses further creations with `quota_exceeded`, and deleting an object frees its place. The device does not yet know how many objects were already created and shows the refusal only after the sync.
- **Expiry:** guests are deactivated after 90 days without activity; activity is any use of the app, and without any use the joining counts (sign-in and token end, their work stays in the history). Participants added by hand are not affected.
