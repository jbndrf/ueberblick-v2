import type { Device } from '../device';
import { sumBadges, type ToolBadge } from './badge';
import { toggle, type Panels } from './panels';

/** "Im Chat erwähnen" opens the chat panel itself (v3 `chatSheetOpen = true`); an open panel stays as it is. */
export function withChat(open: Panels): Panels {
  return open.includes('chat') ? open : toggle(open, 'chat');
}

/**
 * What the device's tools tell the shell: the Werkzeuge badges (v3: unread chat, counted whether or not a panel is
 * open) and the chat's open request. Returns the stop function.
 */
export function bindToolSignals(
  device: Pick<Device, 'toolBadges' | 'chat'>,
  on: { badges: (current: ReturnType<Device['toolBadges']['current']>) => void; openChat: () => void },
): () => void {
  const stops = [
    device.toolBadges.subscribe(() => on.badges(device.toolBadges.current())),
    device.chat.onOpenRequest(on.openChat),
  ];
  return () => stops.forEach((s) => s());
}

/** The Werkzeuge badge: the tools' badges added up, none while the Werkzeuge sheet is open. */
export function toolsBadge(
  badges: Readonly<Record<string, ToolBadge>>,
  tools: readonly { readonly key: string }[],
  open: Panels,
): ToolBadge {
  return sumBadges(
    badges,
    tools.map((t) => t.key),
    open.includes('tools'),
  );
}
