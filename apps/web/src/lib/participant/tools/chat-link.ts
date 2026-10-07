/**
 * "Im Chat erwähnen" (v3 `+page.svelte:2254-2258`, the feature detail module `DetailModule.svelte:485-492`): the feature sheet's
 * ⋮ menu seeds the composer with `#<feature> ` and opens the chat. The sheet and the chat panel never meet, so one
 * link per device carries both: the seed (taken once by the panel, or pushed to an open one) and the request to
 * open the panel (heard by the shell, or taken by the Werkzeuge slot when it mounts later).
 */
import type { ChatSeed } from '@ueberblick/tool-chat';

export interface ChatLink {
  /** The panel's side: the waiting seed, and a ring when one arrives while it is open. */
  readonly seed: ChatSeed;
  /** A feature's ⋮ menu: seeds `#<id> ` and asks for the chat to open. */
  mention(featureId: string): void;
  /** The shell's side: calls `fn` on each request to open the chat. Returns the unsubscribe function. */
  onOpenRequest(fn: () => void): () => void;
  /** True once per request nobody took yet (the slot that mounts after the request). */
  takeOpenRequest(): boolean;
}

export function createChatLink(): ChatLink {
  let seed: string | undefined;
  let requested = false;
  const seedListeners = new Set<() => void>();
  const openListeners = new Set<() => void>();
  return {
    seed: {
      take() {
        const s = seed;
        seed = undefined;
        return s;
      },
      subscribe(fn) {
        seedListeners.add(fn);
        return () => void seedListeners.delete(fn);
      },
    },
    mention(featureId) {
      seed = `${seed ?? ''}#${featureId} `;
      requested = true;
      [...seedListeners].forEach((f) => f());
      [...openListeners].forEach((f) => f());
    },
    onOpenRequest(fn) {
      openListeners.add(fn);
      return () => void openListeners.delete(fn);
    },
    takeOpenRequest() {
      const r = requested;
      requested = false;
      return r;
    },
  };
}
