/**
 * The `event: tool` doorbell over Server-Sent Events (B-020 item 2). The event carries only the tool key
 * (`data: {"tool":"<key>"}`, H5: no data). The `EventSource` is a port, so tests and workers pass their own.
 */
import type { KeyedSignal } from '../sync/contract';

export interface EventSourceLike {
  addEventListener(type: string, listener: (event: { readonly data: unknown }) => void): void;
  close(): void;
}

export function sseToolDoorbell(open: () => EventSourceLike): KeyedSignal {
  return {
    subscribe(onRing) {
      const source = open();
      source.addEventListener('tool', (event) => {
        try {
          const body: unknown = JSON.parse(String(event.data));
          const tool =
            typeof body === 'object' && body !== null ? (body as { tool?: unknown }).tool : undefined;
          if (typeof tool === 'string' && tool !== '') onRing(tool);
        } catch {
          // a malformed ring is not a reason to stop listening; the next pull catches up
        }
      });
      return () => source.close();
    },
  };
}
