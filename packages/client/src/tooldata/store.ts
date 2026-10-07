/**
 * The tool data store: reads from memory (hydrated once at open), writes go to the backend first and to
 * memory after they committed, one at a time. Memory arrays are replaced on change, never mutated, so a
 * reader that holds one keeps a consistent view.
 */
import type { Seq } from '@ueberblick/core/model';
import {
  NOTHING_READ,
  type OutboxEntry,
  type StoredToolRecord,
  type ToolDataBackend,
  type ToolDataStore,
  type ToolDataWrite,
  type ToolMember,
  type ToolPage,
  type ToolReadCursor,
  type ToolRecord,
} from './contract';

interface Stream {
  records: readonly ToolRecord[];
  cursor: Seq;
  read: ToolReadCursor;
  pending: Seq | undefined;
  members: readonly ToolMember[];
  /** Appended in place (O(1)); every other change replaces the array. Readers poll `rev`, not identity. */
  outbox: OutboxEntry[];
  /** Bumped by every committed change of the stream. */
  rev: number;
  /** The seq of each mirrored id: an upsert finds the older row of a re-delivered message. */
  byId: Map<string, Seq>;
}

const NO_MEMBERS: readonly ToolMember[] = [];
const empty = (): Stream => ({
  records: [],
  cursor: 0 as Seq,
  read: NOTHING_READ,
  pending: undefined,
  members: NO_MEMBERS,
  outbox: [],
  rev: 0,
  byId: new Map(),
});

/** Merges ascending `incoming` into ascending `existing` by seq; an equal seq keeps the new row. */
export function mergeRecords(
  existing: readonly ToolRecord[],
  incoming: readonly ToolRecord[],
): readonly ToolRecord[] {
  const first = incoming[0];
  if (first === undefined) return existing;
  const last = existing[existing.length - 1];
  if (last === undefined || first.seq > last.seq) return [...existing, ...incoming];
  const bySeq = new Map<number, ToolRecord>();
  for (const r of existing) bySeq.set(r.seq, r);
  for (const r of incoming) bySeq.set(r.seq, r);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

const NO_RECORDS: readonly ToolRecord[] = [];
const maxSeq = (a: Seq, b: Seq): Seq => (a >= b ? a : b);
const readKey = (tool: string) => `read:${tool}`;
const cursorKey = (tool: string) => `cursor:${tool}`;
const pendingKey = (tool: string) => `pending:${tool}`;
const membersKey = (tool: string) => `members:${tool}`;

export async function openToolDataStore(backend: ToolDataBackend): Promise<ToolDataStore> {
  const snapshot = await backend.load();
  const streams = new Map<string, Stream>();
  const listeners = new Set<(tool: string) => void>();
  const stream = (tool: string): Stream => {
    let s = streams.get(tool);
    if (!s) streams.set(tool, (s = empty()));
    return s;
  };

  const byTool = new Map<string, StoredToolRecord[]>();
  for (const r of snapshot.records) {
    const list = byTool.get(r.tool) ?? [];
    list.push(r);
    byTool.set(r.tool, list);
  }
  for (const [tool, list] of byTool) {
    stream(tool).records = list
      .sort((a, b) => a.seq - b.seq)
      .map((r): ToolRecord => ({
        id: r.id,
        seq: r.seq,
        author: r.author,
        at: r.at,
        body: r.body,
        mentions: r.mentions,
      }));
  }
  for (const st of streams.values()) for (const r of st.records) st.byId.set(r.id, r.seq);
  for (const o of [...snapshot.outbox].sort((a, b) => a.order - b.order)) {
    const s = stream(o.tool);
    s.outbox.push(o);
  }
  for (const [key, value] of Object.entries(snapshot.meta)) {
    const sep = key.indexOf(':');
    const kind = key.slice(0, sep);
    const s = stream(key.slice(sep + 1));
    if (kind === 'cursor') s.cursor = value as Seq;
    else if (kind === 'read') s.read = value as ToolReadCursor;
    else if (kind === 'pending') s.pending = value as Seq;
    else if (kind === 'members') s.members = value as readonly ToolMember[];
  }

  let chain: Promise<unknown> = Promise.resolve();
  /** Runs `body` after every earlier write; `body` writes, then returns what to apply to memory. */
  const serial = <T>(body: () => Promise<T>): Promise<T> => {
    const next = chain.then(body, body);
    chain = next.catch(() => undefined);
    return next;
  };
  const changed = (tool: string) => {
    stream(tool).rev++;
    listeners.forEach((l) => l(tool));
  };
  const write = (w: ToolDataWrite) => backend.write(w);

  return {
    records: (tool) => streams.get(tool)?.records ?? NO_RECORDS,
    cursor: (tool) => streams.get(tool)?.cursor ?? (0 as Seq),
    readCursor: (tool) => streams.get(tool)?.read ?? NOTHING_READ,
    pendingRead: (tool) => streams.get(tool)?.pending,
    members: (tool) => streams.get(tool)?.members ?? NO_MEMBERS,
    outbox: (tool) => streams.get(tool)?.outbox ?? [],
    revision: (tool) => streams.get(tool)?.rev ?? 0,
    tools: () => [...streams.keys()],
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    applyPage: (tool, page: ToolPage) =>
      serial(async () => {
        const s = stream(tool);
        const incoming = page.records.filter((r) => r.seq > s.cursor);
        const ids = new Set(incoming.map((r) => r.id));
        const gone = s.outbox.filter((o) => ids.has(o.id));
        // upsert by id: a message that came back under a newer seq (erasure) or as removed replaces its old row
        const superseded: { tool: string; seq: Seq }[] = [];
        for (const id of [...ids, ...page.removed]) {
          const old = s.byId.get(id);
          if (old !== undefined) superseded.push({ tool, seq: old });
        }
        const cursor = maxSeq(s.cursor, page.last);
        const read: ToolReadCursor = {
          lastReadSeq: maxSeq(s.read.lastReadSeq, page.cursor.lastReadSeq),
          lastMentionSeq: maxSeq(s.read.lastMentionSeq, page.cursor.lastMentionSeq),
        };
        const pendingCovered = s.pending !== undefined && s.pending <= read.lastReadSeq;
        await write({
          records: incoming.map((r) => ({ ...r, tool })),
          ...(superseded.length ? { deleteRecords: superseded } : {}),
          deleteOutbox: gone.map((o) => o.order),
          meta: {
            [cursorKey(tool)]: cursor,
            [readKey(tool)]: read,
            [membersKey(tool)]: page.members,
            ...(pendingCovered ? { [pendingKey(tool)]: null } : {}),
          },
        });
        if (superseded.length) {
          const drop = new Set(superseded.map((d) => d.seq));
          s.records = s.records.filter((r) => !drop.has(r.seq));
        }
        for (const id of page.removed) s.byId.delete(id);
        for (const r of incoming) s.byId.set(r.id, r.seq);
        s.records = mergeRecords(s.records, incoming);
        s.cursor = cursor;
        s.read = read;
        s.members = page.members;
        if (pendingCovered) s.pending = undefined;
        if (gone.length) s.outbox = s.outbox.filter((o) => !ids.has(o.id));
        changed(tool);
      }),

    enqueue: (tool, entry) =>
      serial(async () => {
        const { order } = await write({ addOutbox: { tool, ...entry } });
        if (order === undefined) throw new Error('the backend did not assign an outbox order');
        const row: OutboxEntry = { order, tool, ...entry };
        const s = stream(tool);
        s.outbox.push(row);
        changed(tool);
        return row;
      }),

    confirm: (tool, id, record) =>
      serial(async () => {
        const s = stream(tool);
        const entry = s.outbox.find((o) => o.id === id);
        await write({
          records: [{ ...record, tool }],
          ...(entry ? { deleteOutbox: [entry.order] } : {}),
        });
        s.byId.set(record.id, record.seq);
        s.records = mergeRecords(s.records, [record]);
        if (entry) s.outbox = s.outbox.filter((o) => o.id !== id);
        changed(tool);
      }),

    refuse: (tool, id, refusal) =>
      serial(async () => {
        const s = stream(tool);
        const entry = s.outbox.find((o) => o.id === id);
        if (!entry) return;
        const next: OutboxEntry = { ...entry, refusal };
        await write({ putOutbox: [next] });
        s.outbox = s.outbox.map((o) => (o.id === id ? next : o));
        changed(tool);
      }),

    removeOutbox: (tool, id) =>
      serial(async () => {
        const s = stream(tool);
        const entry = s.outbox.find((o) => o.id === id);
        if (!entry) return;
        await write({ deleteOutbox: [entry.order] });
        s.outbox = s.outbox.filter((o) => o.id !== id);
        changed(tool);
      }),

    noteRead: (tool, seq) =>
      serial(async () => {
        const s = stream(tool);
        if (seq <= s.read.lastReadSeq || (s.pending !== undefined && seq <= s.pending)) return;
        await write({ meta: { [pendingKey(tool)]: seq } });
        s.pending = seq;
        changed(tool);
      }),

    settleRead: (tool, sent, cursor) =>
      serial(async () => {
        const s = stream(tool);
        const read: ToolReadCursor = {
          lastReadSeq: maxSeq(s.read.lastReadSeq, maxSeq(cursor.lastReadSeq, sent)),
          lastMentionSeq: maxSeq(s.read.lastMentionSeq, cursor.lastMentionSeq),
        };
        const covered = s.pending !== undefined && s.pending <= read.lastReadSeq;
        await write({ meta: { [readKey(tool)]: read, ...(covered ? { [pendingKey(tool)]: null } : {}) } });
        s.read = read;
        if (covered) s.pending = undefined;
        changed(tool);
      }),

    close: () => backend.close(),
  };
}
