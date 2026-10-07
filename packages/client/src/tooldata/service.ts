/**
 * The tool data service (B-020, WP-683): the mirror (pull), the outbox (drain), batched read marks, and the
 * `ToolDataHandle` a tool sees. It owns no I/O: the transport, timers and clock are ports.
 * Only tools in `available()` (the person's roles offer them) are pulled or sent; the rest stay untouched.
 */
import type { Instant, Seq } from '@ueberblick/core/model';
import type { Clock } from '@ueberblick/core/ports';
import type { QueueLock } from '../queue/contract';
import { noLock } from '../queue/lock';
import type { Timers, ToolSync, KeyedSignal } from '../sync/contract';
import type {
  OutboxEntry,
  ToolDataHandle,
  ToolDataStore,
  ToolDataTransport,
  ToolItem,
  ToolReadCursor,
  ToolRecord,
} from './contract';

export const TOOL_PAGE_LIMIT = 100;
/** Read marks of one burst (opening a panel, scrolling) wait this long and go out as one request. */
export const TOOL_READ_DELAY_MS = 1_000;

export interface ToolDataDeps {
  readonly store: ToolDataStore;
  readonly transport: ToolDataTransport;
  /** The tool keys this person's roles offer with data access, current at each call. */
  readonly available: () => readonly string[];
  /** The person's id: the author of a pending item. */
  readonly self: () => string;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly timers: Timers;
  /** The `event: tool` doorbell (rings with the tool key only). */
  readonly doorbell: KeyedSignal;
  /** Single-flight of the drain across tabs; default: this tab only. */
  readonly lock?: QueueLock;
  readonly pageLimit?: number;
  readonly readDelayMs?: number;
  /** Called after an item was written to the outbox: the app starts a drain. */
  readonly kick?: () => void;
  /** A background action (read flush, kicked drain) failed. */
  readonly onError: (error: unknown) => void;
}

export interface ToolDrainResult {
  readonly sent: number;
  readonly refused: number;
  /** The drain stopped at a network failure: entries stay, the next drain resumes. */
  readonly transient: boolean;
  /** The drain stopped because the session ended: nothing is lost. */
  readonly unauthenticated: boolean;
}

export interface ToolData extends ToolSync {
  /** Pulls one stream to its end; resolves with the number of records mirrored. Single-flight per tool. */
  pull(tool: string): Promise<number>;
  pullAll(): Promise<void>;
  drain(): Promise<ToolDrainResult>;
  /** Sends the pending read marks, one request per tool. */
  flushReads(): Promise<void>;
  handle(tool: string): ToolDataHandle;
  close(): void;
}

const pendingItem = (e: OutboxEntry, author: string): ToolItem => ({
  id: e.id,
  seq: null,
  author,
  at: e.createdAt,
  body: e.body,
  mentions: { persons: [], features: [] },
  ...(e.refusal ? { refusal: e.refusal } : {}),
});

export function createToolData(deps: ToolDataDeps): ToolData {
  const { store, transport } = deps;
  const lock = deps.lock ?? noLock;
  const limit = deps.pageLimit ?? TOOL_PAGE_LIMIT;
  const isAvailable = (tool: string) => deps.available().includes(tool);
  const pulls = new Map<string, Promise<number>>();
  let readTimer: unknown;
  let marking: Promise<unknown> = Promise.resolve();
  const handles = new Map<string, ToolDataHandle>();

  async function pullToEnd(tool: string): Promise<number> {
    let total = 0;
    for (;;) {
      const before = store.cursor(tool);
      const reply = await transport.page(tool, before, limit);
      if (reply.kind !== 'ok') return total;
      const page = reply.value;
      await store.applyPage(tool, page);
      total += page.records.length;
      if (!page.more || store.cursor(tool) <= before) return total;
    }
  }

  function pull(tool: string): Promise<number> {
    if (!isAvailable(tool)) return Promise.resolve(0);
    const running = pulls.get(tool);
    if (running) return running;
    const p = pullToEnd(tool).finally(() => pulls.delete(tool));
    pulls.set(tool, p);
    return p;
  }

  async function drainLocked(): Promise<ToolDrainResult> {
    let sent = 0;
    let refused = 0;
    for (const tool of store.tools()) {
      if (!isAvailable(tool)) continue;
      for (const entry of store.outbox(tool)) {
        if (entry.refusal) continue;
        let reply;
        try {
          reply = await transport.append(tool, { id: entry.id, body: entry.body });
        } catch {
          return { sent, refused, transient: true, unauthenticated: false };
        }
        if (reply.kind === 'unauthenticated')
          return { sent, refused, transient: false, unauthenticated: true };
        if (reply.kind === 'unavailable') break; // the tool is gone for this person: keep the entries
        if (reply.value.outcome === 'accepted') {
          await store.confirm(tool, entry.id, reply.value.record);
          sent++;
        } else {
          await store.refuse(tool, entry.id, { code: reply.value.code, reason: reply.value.reason });
          refused++;
        }
      }
    }
    return { sent, refused, transient: false, unauthenticated: false };
  }

  async function drain(): Promise<ToolDrainResult> {
    const r = await lock.tryRun(drainLocked);
    return r.ran ? r.value : { sent: 0, refused: 0, transient: false, unauthenticated: false };
  }

  /** The newest mirrored message at or below `seq` that mentions this person: the "read my mentions" mark. */
  function mentionSeqUpTo(tool: string, seq: Seq): Seq {
    const me = deps.self();
    const known = store.readCursor(tool).lastMentionSeq;
    const records = store.records(tool);
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i] as ToolRecord;
      if (r.seq <= known) break; // everything below was marked already
      if (r.seq <= seq && r.mentions.persons.includes(me)) return r.seq;
    }
    return known;
  }

  let flushing: Promise<unknown> = Promise.resolve();
  /** One flush at a time: a second call waits and then sees what the first one already settled. */
  function flushReads(): Promise<void> {
    const run = flushing.then(flushNow, flushNow);
    flushing = run.catch(() => undefined);
    return run;
  }

  async function flushNow(): Promise<void> {
    await marking;
    if (readTimer !== undefined) deps.timers.clear(readTimer);
    readTimer = undefined;
    for (const tool of store.tools()) {
      const seq = store.pendingRead(tool);
      if (seq === undefined || !isAvailable(tool)) continue;
      const reply = await transport.markRead(tool, { seq, mentionSeq: mentionSeqUpTo(tool, seq) });
      if (reply.kind === 'ok') await store.settleRead(tool, seq, reply.value);
    }
  }

  function scheduleRead(): void {
    if (readTimer !== undefined) return;
    readTimer = deps.timers.set(() => {
      readTimer = undefined;
      flushReads().catch(deps.onError);
    }, deps.readDelayMs ?? TOOL_READ_DELAY_MS);
  }

  function makeHandle(tool: string): ToolDataHandle {
    let cached: { readonly rev: number; readonly items: readonly ToolItem[] } | undefined;
    const enqueue = async (body: string): Promise<ToolItem> => {
      const entry = await store.enqueue(tool, {
        id: deps.newId(),
        body,
        createdAt: deps.clock.now() as Instant,
      });
      deps.kick?.();
      return pendingItem(entry, deps.self());
    };
    return {
      items() {
        const rev = store.revision(tool);
        if (cached?.rev === rev) return cached.items;
        const self = deps.self();
        const items: readonly ToolItem[] = [
          ...store.records(tool),
          ...store.outbox(tool).map((e) => pendingItem(e, self)),
        ];
        cached = { rev, items };
        return items;
      },
      subscribe(listener) {
        return store.onChange((t) => {
          if (t === tool) listener();
        });
      },
      append: enqueue,
      get cursor(): ToolReadCursor {
        // what the person has read: the server's answer, or a mark not yet sent (offline reading counts at once)
        const read = store.readCursor(tool);
        const pending = store.pendingRead(tool);
        if (pending === undefined || pending <= read.lastReadSeq) return read;
        return { lastReadSeq: pending, lastMentionSeq: mentionSeqUpTo(tool, pending) };
      },
      members: () => store.members(tool),
      markRead(seq: Seq) {
        marking = marking
          .then(() => store.noteRead(tool, seq))
          .then(() => {
            if (store.pendingRead(tool) !== undefined) scheduleRead();
          })
          .catch(deps.onError);
      },
      async retry(id) {
        const old = store.outbox(tool).find((e) => e.id === id);
        if (!old?.refusal) throw new Error(`"${id}" is not a refused item`);
        const item = await enqueue(old.body);
        await store.removeOutbox(tool, id);
        return item;
      },
      discard: (id) => store.removeOutbox(tool, id),
    };
  }

  return {
    pull,
    async pullAll() {
      await Promise.all(deps.available().map((t) => pull(t)));
    },
    drain,
    flushReads,
    async sync() {
      await drain();
      await flushReads();
      await this.pullAll();
    },
    doorbell: deps.doorbell,
    handle(tool) {
      let h = handles.get(tool);
      if (!h) handles.set(tool, (h = makeHandle(tool)));
      return h;
    },
    close() {
      if (readTimer !== undefined) deps.timers.clear(readTimer);
      readTimer = undefined;
    },
  };
}
