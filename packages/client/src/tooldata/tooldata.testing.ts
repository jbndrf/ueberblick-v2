/** Test kit of tool data: a fake server speaking the B-020 wire, and a clock and id source. Tests only. */
import type { Instant, Seq } from '@ueberblick/core/model';
import { createClock } from '@ueberblick/core/testing';
import { fakeTimers } from '../queue/queue.testing';
import { createToolData, type ToolData, type ToolDataDeps } from './service';
import { openToolDataStore } from './store';
import { memoryBackend, type MemoryBackend } from './backend-memory';
import type {
  ToolDataStore,
  ToolDataTransport,
  ToolMember,
  ToolPage,
  ToolReadCursor,
  ToolReadMark,
  ToolRecord,
  ToolReply,
  ToolRefusal,
} from './contract';

export const T0 = '2026-10-02T08:00:00.000Z' as Instant;

type Row = ToolRecord & { removed?: true };

export class FakeToolServer implements ToolDataTransport {
  readonly streams = new Map<string, Row[]>();
  readonly reads = new Map<string, ToolReadCursor>();
  readonly members = new Map<string, ToolMember[]>();
  readonly available = new Set<string>();
  readonly calls: string[] = [];
  /** The marks of the last read request, as sent. */
  lastMark: ToolReadMark | undefined;
  /** Throws on every call, like a device without network. */
  offline = false;
  unauthenticated = false;
  refuseWith: (body: string) => ToolRefusal | undefined = () => undefined;
  private n = 0;
  private heads = new Map<string, number>();

  constructor(tools: readonly string[] = ['chat']) {
    for (const t of tools) this.available.add(t);
  }

  stream(tool: string): Row[] {
    let s = this.streams.get(tool);
    if (!s) this.streams.set(tool, (s = []));
    return s;
  }

  private nextSeq(tool: string): Seq {
    const seq = (this.heads.get(tool) ?? 0) + 1;
    this.heads.set(tool, seq);
    return seq as Seq;
  }

  /** A record written by someone else (another device): the doorbell would ring for it. */
  post(
    tool: string,
    author: string,
    body: string,
    id = `srv-${++this.n}`,
    mentions: ToolRecord['mentions'] = { persons: [], features: [] },
  ): ToolRecord {
    const seq = this.nextSeq(tool);
    const record: ToolRecord = {
      id,
      seq,
      author,
      at: new Date(Date.parse(T0) + seq * 1000).toISOString() as Instant,
      body,
      mentions,
    };
    this.stream(tool).push(record);
    return record;
  }

  /** Erasure (B-005): the message gets a new seq above the head, redacted (`body`) or removed. */
  erase(tool: string, id: string, redact?: string): void {
    const s = this.stream(tool);
    const i = s.findIndex((r) => r.id === id);
    const old = s[i];
    if (!old) throw new Error(`no message ${id}`);
    s.splice(i, 1);
    const seq = this.nextSeq(tool);
    s.push(
      redact === undefined
        ? { ...old, seq, body: '', author: '', removed: true }
        : { ...old, seq, body: redact },
    );
  }

  private reach<T>(tool: string, value: () => T): ToolReply<T> {
    if (this.offline) throw new Error('offline');
    if (this.unauthenticated) return { kind: 'unauthenticated' };
    if (!this.available.has(tool)) return { kind: 'unavailable' };
    return { kind: 'ok', value: value() };
  }

  async page(tool: string, after: Seq, limit: number) {
    this.calls.push(`page:${tool}:${after}`);
    return this.reach(tool, (): ToolPage => {
      const rows = this.stream(tool)
        .filter((r) => r.seq > after)
        .sort((a, b) => a.seq - b.seq)
        .slice(0, limit);
      const head = (this.heads.get(tool) ?? 0) as Seq;
      const last = (rows[rows.length - 1]?.seq ?? 0) as Seq;
      return {
        records: rows
          .filter((r) => !r.removed)
          .map((r): ToolRecord => ({
            id: r.id,
            seq: r.seq,
            author: r.author,
            at: r.at,
            body: r.body,
            mentions: r.mentions,
          })),
        removed: rows.filter((r) => r.removed).map((r) => r.id),
        last,
        head,
        more: last < head,
        cursor: this.reads.get(tool) ?? { lastReadSeq: 0 as Seq, lastMentionSeq: 0 as Seq },
        members: this.members.get(tool) ?? [],
      };
    });
  }

  async append(tool: string, body: { id: string; body: string }) {
    this.calls.push(`append:${tool}:${body.body}`);
    return this.reach(tool, () => {
      const refusal = this.refuseWith(body.body);
      if (refusal) return { outcome: 'refused' as const, ...refusal };
      const existing = this.stream(tool).find((r) => r.id === body.id);
      return { outcome: 'accepted' as const, record: existing ?? this.post(tool, 'me', body.body, body.id) };
    });
  }

  async markRead(tool: string, mark: ToolReadMark) {
    this.calls.push(`read:${tool}:${mark.seq}`);
    this.lastMark = mark;
    return this.reach(tool, () => {
      const old = this.reads.get(tool);
      const next = {
        lastReadSeq: Math.max(old?.lastReadSeq ?? 0, mark.seq) as Seq,
        lastMentionSeq: Math.max(old?.lastMentionSeq ?? 0, mark.mentionSeq) as Seq,
      };
      this.reads.set(tool, next);
      return next;
    });
  }
}

let ids = 0;

export interface Kit {
  readonly server: FakeToolServer;
  readonly backend: MemoryBackend;
  readonly store: ToolDataStore;
  readonly data: ToolData;
  readonly timers: ReturnType<typeof fakeTimers>;
  /** A second boot on the same backend: what a reload does. */
  reopen(): Promise<Kit>;
}

export async function kit(
  over: Partial<ToolDataDeps> & { server?: FakeToolServer; backend?: MemoryBackend } = {},
): Promise<Kit> {
  const server = over.server ?? new FakeToolServer();
  const backend = over.backend ?? memoryBackend();
  const store = await openToolDataStore(backend);
  const timers = fakeTimers();
  const clock = createClock(T0);
  const data = createToolData({
    store,
    transport: server,
    available: () => ['chat'],
    self: () => 'me',
    clock,
    newId: () => `id-${++ids}`,
    timers,
    doorbell: { subscribe: () => () => undefined },
    onError: (e) => {
      throw e;
    },
    ...over,
  });
  return {
    server,
    backend,
    store,
    data,
    timers,
    reopen: async () => {
      data.close();
      store.close();
      return kit({ ...over, server, backend });
    },
  };
}
