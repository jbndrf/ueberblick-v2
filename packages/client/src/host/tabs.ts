/**
 * One tab pulls per device database (WP-572). The tab holding the Web Lock `ueberblick-sync:<db>` runs the sync
 * worker; every other tab is a follower: it starts no worker, does no sync work, and stays current from the
 * holder's change notices over a `BroadcastChannel`. A follower's doorbell (`pull`) is forwarded to the holder.
 * When the holder goes away the browser releases its lock and the next waiting tab takes over from the stored
 * cursor. Both browser APIs are structural ports here (like `webQueueLock`): tests pass fakes.
 */
import type { PullResult } from '../sync/contract';
import { fromWire, toWire, type WireError } from './protocol';

export interface AbortSignalLike {
  readonly aborted: boolean;
}

/** The part of the Web Locks manager used here; a real `LockManager` satisfies it. */
export interface SyncLockManagerLike {
  request(
    name: string,
    options: { readonly ifAvailable?: true; readonly signal?: AbortSignalLike },
    callback: (lock: object | null) => Promise<unknown>,
  ): Promise<unknown>;
}

/** The part of `BroadcastChannel` used here. A channel never delivers to itself. */
export interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  close(): void;
}

export interface TabCoordination {
  readonly locks: SyncLockManagerLike;
  /** One channel per database name, shared by every tab of it. */
  readonly channel: BroadcastChannelLike;
  /** Tells this tab from the others on the channel. */
  readonly tabId: string;
}

export const syncLockName = (database: string): string => `ueberblick-sync:${database}`;

/** Channel messages; `ch` is a transport tag. */
type Channel =
  | { readonly ch: 'feed'; readonly data: unknown }
  | { readonly ch: 'holder' }
  | { readonly ch: 'pull'; readonly tab: string; readonly id: number }
  | {
      readonly ch: 'pulled';
      readonly tab: string;
      readonly id: number;
      readonly result?: PullResult;
      readonly error?: WireError;
    };

export interface TabHost {
  /** Init, replica check and start of this tab's worker; called when the tab becomes the holder. */
  startWorker(): Promise<void>;
  /** A pull on this tab's own worker. */
  pullLocal(): Promise<PullResult>;
  /** A holder's message, handled like the own worker's but never answered (a follower has no worker). */
  feed(data: unknown): void;
  fault(error: Error): void;
}

export interface Tabs {
  isHolder(): boolean;
  /** Decides the role. Resolves once a holder's worker runs, or at once for a follower (which waits in line). */
  begin(): Promise<void>;
  /** The holder forwards each message of its worker to the followers. */
  relay(data: unknown): void;
  /**
   * A pull from this tab. The holder pulls on its own worker; during its takeover, while the worker is not yet
   * started, the pull waits for the start and then runs (pulls in that window run as one). A follower's pull is
   * a doorbell: the holder pulls and answers.
   */
  pull(): Promise<PullResult>;
  close(): void;
}

const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';
const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

export function openTabs(c: TabCoordination, database: string, host: TabHost): Tabs {
  const name = syncLockName(database);
  let holder = false;
  let closed = false;
  let release: (() => void) | undefined;
  let waiting: AbortController | undefined;
  /** Set from the lock grant until the worker started: the takeover window. */
  let starting: Promise<void> | undefined;
  /** The one worker pull of everything asked in the window. */
  let windowPull: Promise<PullResult> | undefined;
  let nextId = 1;
  const pending = new Map<number, { resolve: (r: PullResult) => void; reject: (e: unknown) => void }>();

  const send = (m: Channel) => c.channel.postMessage(m);
  const ask = (id: number) => send({ ch: 'pull', tab: c.tabId, id });

  /** A pull on this tab's worker, held until the worker has started (never refused, never dropped). */
  function local(): Promise<PullResult> {
    if (!starting) return host.pullLocal();
    windowPull ??= starting.then(() => host.pullLocal());
    return windowPull;
  }

  function serve(m: Extract<Channel, { ch: 'pull' }>): void {
    local().then(
      (result) => send({ ch: 'pulled', tab: m.tab, id: m.id, result }),
      (e: unknown) => send({ ch: 'pulled', tab: m.tab, id: m.id, error: toWire(e) }),
    );
  }

  c.channel.onmessage = (event) => {
    const m = event.data as Channel;
    if (closed || typeof m !== 'object' || m === null) return;
    if (m.ch === 'feed' && !holder) host.feed(m.data);
    else if (m.ch === 'holder' && !holder) for (const id of pending.keys()) ask(id);
    else if (m.ch === 'pull' && holder && m.tab !== c.tabId) serve(m);
    else if (m.ch === 'pulled' && m.tab === c.tabId) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.result) p.resolve(m.result);
      else p.reject(fromWire(m.error as WireError));
    }
  };

  /** Runs while this tab holds the lock: the returned promise ends at `close`. */
  function hold(decided: () => void): Promise<void> {
    holder = true;
    return new Promise<void>((done) => {
      release = done;
      const start = host.startWorker();
      starting = start;
      const settle = () => {
        starting = undefined;
        windowPull = undefined;
      };
      start.then(
        () => {
          send({ ch: 'holder' });
          // pulls a follower forwarded to the tab that has since left: this tab runs them now, as one with
          // any pull made in the window (`starting` is still set here)
          for (const [id, p] of [...pending]) {
            pending.delete(id);
            local().then(p.resolve, p.reject);
          }
          settle();
          decided();
        },
        (e: unknown) => {
          settle();
          host.fault(asError(e));
          decided();
        },
      );
      // a pull that waited on a failed start is rejected with it; the fault above reports it once
      start.catch(() => undefined);
    });
  }

  function queue(): void {
    waiting = new AbortController();
    c.locks
      .request(name, { signal: waiting.signal }, () => hold(() => undefined))
      .catch((e: unknown) => {
        if (!isAbort(e)) host.fault(asError(e));
      });
  }

  return {
    isHolder: () => holder,
    async begin() {
      await new Promise<void>((decided) => {
        const run = (lock: object | null) => {
          if (lock !== null) return hold(decided);
          decided();
          return Promise.resolve();
        };
        c.locks.request(name, { ifAvailable: true }, run).catch((e: unknown) => {
          host.fault(asError(e));
          decided();
        });
      });
      if (!holder && !closed) queue();
    },
    relay: (data) => send({ ch: 'feed', data }),
    pull: () =>
      holder
        ? local()
        : new Promise<PullResult>((resolve, reject) => {
            const id = nextId++;
            pending.set(id, { resolve, reject });
            ask(id);
          }),
    close() {
      if (closed) return;
      closed = true;
      waiting?.abort();
      release?.();
      for (const p of pending.values()) p.reject(new Error('the sync host was disposed'));
      pending.clear();
      c.channel.onmessage = null;
      c.channel.close();
    },
  };
}
