// Grouping of the chat thread (v3 `MessageList.svelte:199-242`): consecutive messages by one author, each less
// than five minutes after the one before it in the group, share one header line "{name} · {time}". Pure.
import type { ToolDataItem } from '@ueberblick/ui/tool-api';

/** v3's gap: a message more than this after the previous one of the same author starts a new group. */
export const GROUP_GAP_MS = 5 * 60_000;

export interface ThreadGroup {
  /** The id of the first message: stable while later messages join the group. */
  readonly key: string;
  readonly author: string;
  /** The reader wrote it (author is the signed-in person). */
  readonly mine: boolean;
  /** The first message's time: the header line shows it. */
  readonly at: string;
  readonly items: readonly ToolDataItem[];
}

/**
 * A grouper keeps the groups of the last list and, for a new list, regroups only from the group that holds the first
 * change: a new message at the end costs the change, not 10,000 messages (R14). Items are compared by identity, so the
 * caller gives the same item objects for the messages that did not change (the device does: records are stored once).
 */
export function createGrouper(self: string): (items: readonly ToolDataItem[]) => readonly ThreadGroup[] {
  let prev: readonly ToolDataItem[] = [];
  let prevLength = 0;
  /** Where each kept group starts in the list. */
  let starts: number[] = [];
  let groups: ThreadGroup[] = [];

  return (items) => {
    let common = 0;
    const limit = Math.min(prevLength, items.length);
    while (common < limit && prev[common] === items[common]) common++;
    // the group holding the last unchanged item may take the next one: it is rebuilt too
    let keep = 0;
    while (keep < groups.length && (starts[keep + 1] ?? prevLength) < common) keep++;
    groups = groups.slice(0, keep);
    starts = starts.slice(0, keep);
    const from =
      keep === 0 ? 0 : (starts[keep - 1] as number) + (groups[keep - 1] as ThreadGroup).items.length;

    let tail: { group: ThreadGroup; items: ToolDataItem[]; last: number } | undefined;
    const open: NonNullable<typeof tail>[] = [];
    for (let i = from; i < items.length; i++) {
      const item = items[i] as ToolDataItem;
      const at = Date.parse(item.at);
      if (tail !== undefined && tail.group.author === item.author && at - tail.last < GROUP_GAP_MS) {
        tail.items.push(item);
        tail.last = at;
        continue;
      }
      const list = [item];
      tail = {
        group: { key: item.id, author: item.author, mine: item.author === self, at: item.at, items: list },
        items: list,
        last: at,
      };
      open.push(tail);
      starts.push(i);
    }
    groups = [...groups, ...open.map((o) => o.group)];
    prev = items;
    prevLength = items.length;
    return groups;
  };
}

/** `items` are oldest first, as `ctx.data.items()` lists them; a pending send comes last. */
export const groupThread = (items: readonly ToolDataItem[], self: string): readonly ThreadGroup[] =>
  createGrouper(self)(items);

/** The header line's time, in the reader's locale (v3: `toLocaleString()`, which followed the device). */
export function timeLabel(at: string, locale: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(locale);
}
