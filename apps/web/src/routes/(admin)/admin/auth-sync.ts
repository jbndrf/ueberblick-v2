/**
 * Tells the other tabs of this browser that the admin signed in or out (v3: PocketBase `onAuthStateChange`,
 * `+layout.svelte:300-312`). A BroadcastChannel carries it; without one, a `storage` event does.
 */
export type AuthEvent = 'signed-in' | 'signed-out';

const NAME = 'ueberblick-admin-auth';
const isAuthEvent = (value: unknown): value is AuthEvent => value === 'signed-in' || value === 'signed-out';

export interface AuthSync {
  /** Tell the other tabs (never this one). */
  post(event: AuthEvent): void;
  /** Hear the other tabs; returns the stop function. */
  listen(handler: (event: AuthEvent) => void): () => void;
  close(): void;
}

export function authSync(): AuthSync {
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(NAME);
    return {
      post: (event) => channel.postMessage(event),
      listen(handler) {
        const onmessage = (e: MessageEvent<unknown>): void => {
          if (isAuthEvent(e.data)) handler(e.data);
        };
        channel.addEventListener('message', onmessage);
        return () => channel.removeEventListener('message', onmessage);
      },
      close: () => channel.close(),
    };
  }
  let n = 0;
  return {
    post(event) {
      try {
        localStorage.setItem(NAME, `${event}:${Date.now()}:${(n += 1)}`);
      } catch {
        // storage blocked: the other tabs find out at their next request
      }
    },
    listen(handler) {
      const onstorage = (e: StorageEvent): void => {
        const event = e.key === NAME ? e.newValue?.split(':')[0] : undefined;
        if (isAuthEvent(event)) handler(event);
      };
      window.addEventListener('storage', onstorage);
      return () => window.removeEventListener('storage', onstorage);
    },
    close: () => undefined,
  };
}
