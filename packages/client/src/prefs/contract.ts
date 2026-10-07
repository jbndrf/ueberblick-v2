import type { PrefEntry, PrefStore, Prefs } from '@ueberblick/core/prefs';

/** Where the device keeps its copy: localStorage-like and synchronous. Keyed by project and participant by the client. */
export interface KeyValueStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** What the server answers to GET and PATCH `/api/p/<project>/prefs`. */
export interface PrefsReply {
  readonly entries: PrefStore;
}

/** The two calls to the server. A rejected promise means "could not reach it"; the client keeps its edits then. */
export interface PrefsTransport {
  fetch(): Promise<PrefsReply>;
  send(entries: readonly PrefEntry[]): Promise<PrefsReply>;
}

export type PrefsListener = (prefs: Prefs) => void;

export interface PrefsClient {
  /** The record to show: the server copy merged with the edits not yet sent. Available offline from the cache. */
  current(): Prefs;
  /** The stamped entries behind `current()` (what a merge works on). */
  entries(): PrefStore;
  /** Edits not yet acknowledged by the server. */
  pending(): readonly PrefEntry[];
  /**
   * One edit of one key, stamped with the device clock and applied at once. Throws when the key is unknown or the
   * value has the wrong type. Works offline; the edit is sent by the next `sync()`.
   */
  set(path: string, value: PrefEntry['value']): void;
  /**
   * Sends the pending edits (or just reads when there are none) and merges the server's answer. Called before the map
   * opens and by the sync worker on every sync. Resolves false when the server could not be reached.
   */
  sync(): Promise<boolean>;
  /** Calls `fn` after every change of `current()`. Returns the unsubscribe function. */
  subscribe(fn: PrefsListener): () => void;
}
