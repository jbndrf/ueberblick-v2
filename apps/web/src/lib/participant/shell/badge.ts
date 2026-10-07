/**
 * The Werkzeuge badge on the bar and the header icon (`BottomControlBar.svelte:105`, `+layout.svelte:600`): a hard
 * count (red, "99+" above 99) of things that need the person, or a soft dot (something new, no count). v3's only
 * source was unread chat; here every tool may report one (`ToolBadge`) and the shell adds them up, so a tool that
 * gets one is a line in the tool's own code and nothing in the shell (R13). While the Werkzeuge sheet is open the
 * badge is cleared (v3 `+page.svelte:2539`: the person is looking at it).
 */
export interface ToolBadge {
  readonly hard: number;
  readonly soft: boolean;
}

export const NO_BADGE: ToolBadge = { hard: 0, soft: false };

/** The sum of the tools' badges; none while the Werkzeuge sheet is open. */
export function sumBadges(
  badges: Readonly<Record<string, ToolBadge>>,
  keys: readonly string[],
  toolsSheetOpen: boolean,
): ToolBadge {
  if (toolsSheetOpen) return NO_BADGE;
  let hard = 0;
  let soft = false;
  for (const k of keys) {
    const b = badges[k];
    if (b === undefined) continue;
    hard += b.hard;
    soft ||= b.soft;
  }
  return { hard, soft };
}

/** The text of a hard count: "99+" above 99. */
export const badgeText = (hard: number): string => (hard > 99 ? '99+' : String(hard));
