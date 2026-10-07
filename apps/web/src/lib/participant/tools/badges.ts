/**
 * What the tools report for the Werkzeuge badge (`shell/badge.ts`): one `ToolBadge` per data tool, computed from the
 * tool's stream on the device whether or not its panel is open. The shell adds them up and knows no tool names (R13):
 * a tool with a badge is one entry in `BADGE_OF`.
 */
import type { ToolDataHandle } from '@ueberblick/client';
import type { ToolDataCursor, ToolDataItem } from '@ueberblick/ui/tool-api';
import type { ToolBadge } from '../shell/badge';
import { chatBadge } from './chat-badge';

type BadgeOf = (items: readonly ToolDataItem[], cursor: ToolDataCursor, self: string) => ToolBadge;

/** The badge function of each tool that reports one. */
const BADGE_OF: Readonly<Record<string, BadgeOf>> = { chat: chatBadge };

export interface ToolBadges {
  current(): Readonly<Record<string, ToolBadge>>;
  /** Calls `fn` when a badge changed. Returns the unsubscribe function. */
  subscribe(fn: () => void): () => void;
  close(): void;
}

export interface ToolBadgesDeps {
  readonly data: { handle(tool: string): Pick<ToolDataHandle, 'items' | 'cursor' | 'subscribe'> };
  /** The data tools the app has (the manifest's). */
  readonly keys: readonly string[];
  /** The signed-in person's id. */
  readonly self: string;
}

export function createToolBadges(deps: ToolBadgesDeps): ToolBadges {
  const listeners = new Set<() => void>();
  let badges: Record<string, ToolBadge> = {};
  const stops: (() => void)[] = [];

  function compute(key: string, badgeOf: BadgeOf): void {
    const handle = deps.data.handle(key);
    const next = badgeOf(handle.items(), handle.cursor, deps.self);
    const old = badges[key];
    if (old !== undefined && old.hard === next.hard && old.soft === next.soft) return;
    badges = { ...badges, [key]: next };
    listeners.forEach((l) => l());
  }

  for (const key of deps.keys) {
    const badgeOf = BADGE_OF[key];
    if (badgeOf === undefined) continue;
    compute(key, badgeOf);
    stops.push(deps.data.handle(key).subscribe(() => compute(key, badgeOf)));
  }
  return {
    current: () => badges,
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    close() {
      stops.splice(0).forEach((s) => s());
      listeners.clear();
    },
  };
}
