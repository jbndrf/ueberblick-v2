# @ueberblick/tool-chat

The Projekt-Chat (B-020, WP-684): v3's chat panel body as a `tools-sheet` tool with a data stream. `createChatTool(deps)` returns the `defineTool` result (`data: true`: the host gives it `ctx.data`, WP-683).

- **What it does.** Messages grouped by author within 5 minutes ("Du" / "Unbekannt", own bubbles right, others left), `@person` chips (yellow when they mention the reader) and `#feature` chips (a tap calls `ctx.openFeature`, the panel stays), the empty state, a composer (person picker "Jemanden erwähnen", box "Nachricht…", Enter sends, Shift+Enter or Alt+Enter adds a line). A send shows "Wird gesendet …" until the server has it, and the reason with "Erneut senden" / "Verwerfen" when it was refused.
- **Reading.** The tool marks the newest server seq read once when the panel opens and once per new batch (`ctx.data.markRead`). The unread counts and the Werkzeuge badge are the app's (`apps/web/src/lib/participant/tools/badges.ts`), not the tool's.
- **What it takes** (`ChatDeps`): `self`, `nameOf`, `people`, `featureLabel`, all answered from what is on the device, and the `seed` port ("Im Chat erwähnen" appends `#<id> ` to the draft, never sends). The panel shell (non-modal aside, header "Projekt-Chat", close "Schließen", visualViewport height) is the app's `ToolPanel`.
- **Mentions** are read by one parser, `@ueberblick/core/mentions` (the server uses the same one). Names and labels are looked up when a message is drawn, so a renamed person shows under the new name; an unknown id shows as its first four characters and an ellipsis.
- **Scrolling and size.** The thread draws a window of groups (`window.ts`, binary search over measured heights), so 10,000 messages are about 20 DOM rows. It follows new messages only while the reader is at the bottom, or for their own message.
- **Not here** (owner question M5): edit and delete, a `#` search while typing, notifications.
- Files: `thread.ts` (grouping), `body.ts` (chips), `compose.ts` (draft edits), `window.ts` (virtual window), `list.ts`, `thread-view.ts`, `composer.ts`, `chat-tool.ts`. Pure parts have property tests; the tool has jsdom tests with axe at 390 and 1280 px.
