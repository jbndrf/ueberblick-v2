/** Test helpers for tab coordination: an in-memory lock manager (Web Locks semantics) and a broadcast bus. Tests only. */
import type { BroadcastChannelLike, SyncLockManagerLike } from './tabs';

interface Waiter {
  readonly run: () => void;
  readonly cancel: (e: unknown) => void;
}

/** Exclusive locks by name; `ifAvailable` and `signal` as in the Web Locks API. */
export class FakeLocks implements SyncLockManagerLike {
  private readonly held = new Set<string>();
  private readonly queues = new Map<string, Waiter[]>();
  requests = 0;

  request(
    name: string,
    options: { readonly ifAvailable?: true; readonly signal?: { readonly aborted: boolean } },
    callback: (lock: object | null) => Promise<unknown>,
  ): Promise<unknown> {
    this.requests++;
    if (options.ifAvailable && this.held.has(name)) return callback(null);
    return new Promise((resolve, reject) => {
      const grant = () => {
        this.held.add(name);
        callback({})
          .then(resolve, reject)
          .finally(() => this.free(name));
      };
      if (!this.held.has(name)) return grant();
      const waiter: Waiter = { run: grant, cancel: reject };
      const q = this.queues.get(name) ?? [];
      q.push(waiter);
      this.queues.set(name, q);
      const signal = options.signal as (AbortSignal & object) | undefined;
      signal?.addEventListener('abort', () => {
        const at = q.indexOf(waiter);
        if (at < 0) return;
        q.splice(at, 1);
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    });
  }

  private free(name: string): void {
    this.held.delete(name);
    this.queues.get(name)?.shift()?.run();
  }
}

/** Channels on one bus deliver to every other channel, asynchronously and in order; never to the sender. */
export class FakeBus {
  /** Tests drop deliveries here (a holder that died mid-page); default delivers all. */
  filter: (data: unknown) => boolean = () => true;
  private readonly channels = new Set<FakeChannel>();
  channel(): BroadcastChannelLike {
    const c = new FakeChannel(this);
    this.channels.add(c);
    return c;
  }
  deliver(from: FakeChannel, data: unknown): void {
    if (!this.filter(data)) return;
    for (const c of this.channels)
      if (c !== from)
        setTimeout(() => {
          if (this.channels.has(c)) c.onmessage?.({ data: structuredClone(data) });
        }, 0);
  }
  drop(c: FakeChannel): void {
    this.channels.delete(c);
  }
}

class FakeChannel implements BroadcastChannelLike {
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  constructor(private readonly bus: FakeBus) {}
  postMessage(message: unknown): void {
    this.bus.deliver(this, message);
  }
  close(): void {
    this.bus.drop(this);
  }
}
