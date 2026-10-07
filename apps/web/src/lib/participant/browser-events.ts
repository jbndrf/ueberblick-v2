/**
 * The server's one SSE stream per project (`/api/p/<project>/sync/events`) carries two doorbells: `event: seq` (the
 * feature sync) and `event: tool` (a tool stream, B-020). Both share one `EventSource`, because a browser allows few
 * connections per origin; the connection closes when the last listener lets go. The `EventSource` constructor is a
 * port (the browser's in `browser.ts`, a fake in the spec).
 */
import type { EventSourceLike } from '@ueberblick/client';

export type EventSourceCtor = new (url: string) => EventSourceLike & {
  removeEventListener(type: string, listener: (event: { readonly data: unknown }) => void): void;
};

type Listener = (event: { readonly data: unknown }) => void;

export interface SharedEvents {
  /** One handle for one subscriber: its listeners are removed by `close`, the connection when none is left. */
  open(project: string): EventSourceLike;
}

export function sharedEvents(create: EventSourceCtor): SharedEvents {
  const open = new Map<string, { source: InstanceType<EventSourceCtor>; refs: number }>();
  return {
    open(project) {
      let entry = open.get(project);
      if (entry === undefined) {
        entry = { source: new create(`/api/p/${project}/sync/events`), refs: 0 };
        open.set(project, entry);
      }
      entry.refs++;
      const held = entry;
      const mine: [string, Listener][] = [];
      let closed = false;
      return {
        addEventListener(type, listener) {
          held.source.addEventListener(type, listener);
          mine.push([type, listener]);
        },
        close() {
          if (closed) return;
          closed = true;
          for (const [type, l] of mine) held.source.removeEventListener(type, l);
          if (--held.refs === 0) {
            held.source.close();
            open.delete(project);
          }
        },
      };
    },
  };
}
