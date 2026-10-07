/**
 * The Werkzeuge badge of the chat (v3 `unread-store.svelte.ts:324-343`): messages of others after the read mark are
 * unread (the soft dot), those that mention the reader above the mention mark are the hard count. v3 compared the
 * client clock with the server's `created`; here both marks are server seqs, so a fast clock cannot hide a message.
 * Reading clears both, because the panel marks the newest seq read. A send that waits (no seq) never counts.
 */
import type { ToolDataCursor, ToolDataItem } from '@ueberblick/ui/tool-api';
import type { ToolBadge } from '../shell/badge';

/** `items` are oldest first (server order, then waiting sends); the walk stops at the read mark, so it costs the unread tail only. */
export function chatBadge(items: readonly ToolDataItem[], cursor: ToolDataCursor, self: string): ToolBadge {
  let unread = 0;
  let mentions = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i] as ToolDataItem;
    if (item.seq === null) continue;
    if (item.seq <= cursor.lastReadSeq) break;
    if (item.author === self) continue;
    unread++;
    if (item.seq > cursor.lastMentionSeq && item.mentions.persons.includes(self)) mentions++;
  }
  return { hard: mentions, soft: unread > 0 };
}
