/**
 * The 'session-changed' message between the tabs of one browser (WP-768). They share one session cookie, so a sign-in
 * in one tab (the login exchange) or a device that finds the cookie turned to another participant tells every tab to
 * look at the session again. The channel exists in the page and in the sync worker. Without one, the server's own
 * check (409 `session_changed`) still stops a tab at its next request.
 */
const NAME = 'ub-session-changed';
const MESSAGE = 'session-changed';

/** Names this document (or worker): a sign-in page is the same document as the map that follows it. */
const SENDER = Math.random().toString(36).slice(2);

interface Announcement {
  readonly type: typeof MESSAGE;
  readonly from: string;
  readonly toSender: boolean;
}

/**
 * Tell the other tabs (and the other contexts of this one) that the session may belong to someone else now.
 * `toSender: false` keeps the announcement from the listeners of the sending document itself. The login exchange
 * needs that: the map that opens next in the same document starts on its own, and a second start would open the
 * device twice over one database.
 */
export function announceSessionChanged(toSender = true): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(NAME);
  const message: Announcement = { type: MESSAGE, from: SENDER, toSender };
  channel.postMessage(message);
  channel.close();
}

/** Hear the announcements; returns the stop function. */
export function listenSessionChanged(handler: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(NAME);
  channel.onmessage = (e: MessageEvent<unknown>) => {
    const m = e.data as Partial<Announcement> | null;
    if (m?.type !== MESSAGE) return;
    if (m.from === SENDER && m.toSender !== true) return;
    handler();
  };
  return () => channel.close();
}
