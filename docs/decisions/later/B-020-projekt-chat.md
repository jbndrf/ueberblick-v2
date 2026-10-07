# B-020 Projekt-Chat: a tool over a per-tool data stream, messages in a module table
priority: high        status: provisional
date: 2026-10-02   lead: b   work packages: WP-682 (server + contract), WP-683 (device `ctx.data`), WP-684 (chat tool)   touches: O8, R1, R3, R13, R14, docs/04, tool platform §3.6, B-005

## Context
The owner keeps v3's Projekt-Chat (§10.9; rebuild.md step 5). `docs/decisions/open.md` O8 defaulted to "out of core; module later", and docs/04 says "Chat is a module with its own `messages` table, outside core". The tool platform (`docs/research/v3-parity/tool-platform.md` §3.6) plans a `ctx.data` port, a per-tool data stream that rides on the existing sync. The v3 behaviour is inventoried in `docs/research/v3-parity/chat-v3-inventory.md`. Key facts from it:
- v3 had **no** edit or delete UI;
- no `#` autocomplete (feature mentions come only from "Im Chat erwähnen");
- no notification beyond the badges;
- every message was loaded;
- unread was computed from client clocks.

## Options
- A) **Messages as runs and observations on a "chat" feature type.** This would put chat into core, the fold and the config, and every message would be a run. Rejected: chat is not a geo-referenced feature, and it would make every project template carry a chat type (R4).
- B) **A tool over `ctx.data`, with a module table per project.** The server keeps chat messages in a `messages` table of the project DB. It is registered as one numbered entry in the one `PROJECT_MIGRATIONS` list (`packages/server/src/db/project-schema.ts`); the module owns its SQL, and there is no second migration mechanism. Devices mirror the stream and send through a small outbox. The doorbell announces new messages.

## Chosen (provisional)
B. Chat data is not domain data. R3 ("runs are the only write path") covers features and edges, and chat messages never change features.

1. **Contract `ctx.data`** (tool host, `TOOL_API_VERSION` +1).
   - `ctx.data.items()`: a readable store of the tool's records on this device, oldest first.
   - `ctx.data.append(body)`: returns the record at once with a local status `pending`, kept in the device outbox until the server accepts it.
   - `ctx.data.cursor` and `ctx.data.markRead(seq)`.
   - Records are `{ id (client UUID, idempotent), seq (server order, null while pending), author, at (server time), body, mentions: { persons, features } }`.
   - The port is generic per tool key. Chat is the first user.
2. **Server module** `packages/server/src/modules/chat/**`.
   - Table `messages(id, seq, author, at, body, …)` plus index tables `message_persons(message_id, person_id)` and `message_features(message_id, feature_id)`. Erasure and export (B-005) find messages by author, by mentioned person and by mentioned feature through an index, as `runs.feature_id` did (WP-362).
   - **Erasure re-delivers** (lead rule 2026-10-02). Erasure never deletes a row: a changed message (the author's become `removed`, with `body: null` and `author: null`; a mention of the erased person or feature becomes `[removed]` in the text) gets a new `seq` above the head. `GET ?after=` then re-delivers it and devices upsert by `id`.
   - Read state `chat_reads(person_id, last_read_seq, last_mention_seq)`. It is monotonic and compares **server seq, never clocks** ("better, because v3 mixed the client clock and the server time").
   - Routes are `GET /api/p/<project>/tools/chat?after=<seq>&limit` (paged), `POST …/tools/chat` (idempotent by id) and `POST …/tools/chat/read`. The doorbell carries an `event: tool` with the tool key, but no data (H5).
   - Access means the person has at least one role whose app profile has the chat tool `offered` or `active` in the deployed config (WP-613 availability). Otherwise the answer is 403/404, as the pack download does.
3. **Mentions.** There is one pure parser, `@ueberblick/core/mentions` (R1: v3 had a client copy and a server copy). The tokens are `@<person id>` and `#<feature id>` in the body.
   - The server re-extracts them, and drops unknown or foreign ids from the index; the body text keeps them, as v3 did.
   - Names and feature labels are looked up when the message is drawn. On the device, that uses only data on the device: the owner rule "the device shows only what is on the device".
4. **Behaviour is v3's** (inventory §2–§5):
   - Werkzeuge tile "Projekt-Chat" with the red mention count or the grey dot.
   - A non-modal right panel (`w-full md:w-96`) that follows the visualViewport height.
   - Grouping by author within 5 minutes; "Du" / "Unbekannt"; the @ and # chips.
   - The person picker "Jemanden erwähnen"; Enter sends, Shift+Enter adds a line.
   - "Im Chat erwähnen" in the feature header's ⋮ menu seeds `#<id> `.
   - Reading clears both badges.
5. **Not ported**, so nothing is invented:
   - edit and delete (v3 had server rules but no UI);
   - `#` autocomplete;
   - notifications.
   Each is a seam for the owner (QUESTIONS.md).
6. **Fixed v3 bugs** ("better, because"):
   - the panel scrolls to the bottom only if the reader is at the bottom;
   - "Schließen" replaces the English aria-label;
   - a pending or refused send is visible and can be retried, through the outbox state;
   - the read state is written once per open and once per new message batch, not per message.
7. **Budgets (R14).**
   - The device mirrors the whole project chat, as v3 did. The sync is paged, and the list renders a window (virtualised), so 10,000 messages stay within the sheet budget on a cheap phone.
   - The bench goes in WP-684.
   - The server pages by `seq` with an index.

## Seams
- `ctx.data` is generic, so live layers and dispatch (docs/11) can use it.
- A retention limit, edit and delete, and notifications can each be added without a schema change. Edit/delete need `edited_at` / `deleted_at` columns, which a later migration entry adds.
- The admin "Chat" section (lead-a, WP-375's Projekteinstellungen) writes the per-role tool availability. "Leer = alle" means offered to every role.

## Open
- Retention and moderation (v3 had none) are for the owner list if anyone asks.
