/**
 * Tool data on the device (B-020 item 1, WP-683): the device side of the tool host's `ctx.data` port.
 * CONTRACT: changes need the lead. The server side is WP-682.
 *
 * - One stream per tool key: records in server order (`seq`), mirrored in the device's own store and paged
 *   from `after=<seq>`. A tool never calls the network (tool-platform.md §3.6).
 * - A send is written to the outbox first and sent later, one at a time, in creation order. The server is
 *   idempotent by the client-minted `id`; a refusal marks the entry `refused` with the reason.
 * - Read state compares server seq, never clocks. `markRead` is batched into one request.
 * - A record is upserted by `id`: erasure re-delivers a changed message under a new seq, or as removed.
 * - The doorbell carries only the tool key (H5). Data always comes from a pull.
 * - The store is its own database next to the device store (`<name>-tooldata`): the outbox is irreplaceable
 *   like queued runs, the mirror is a cache, and neither may be touched by `clearCache` of the feature store.
 */
import type { Instant, Seq } from '@ueberblick/core/model';

/** Who and what a record mentions, as the server's index holds them (unknown ids are already dropped). */
export interface ToolMentions {
  readonly persons: readonly string[];
  readonly features: readonly string[];
}

/** A person who has the tool, by name only: what the person picker of the chat lists (v3 `mentionable-participants`). */
export interface ToolMember {
  readonly id: string;
  readonly name: string;
}

/** One value of the device's meta store: a seq, the read position, or a stream's members. */
export type ToolMeta = number | ToolReadCursor | readonly ToolMember[];

/** One record of a tool's stream as the server sends it. */
export interface ToolRecord {
  /** Client UUID: the idempotency key. */
  readonly id: string;
  readonly seq: Seq;
  readonly author: string;
  /** Server time. */
  readonly at: Instant;
  readonly body: string;
  readonly mentions: ToolMentions;
}

/** The person's read position in one stream, by server seq. Monotonic. */
export interface ToolReadCursor {
  readonly lastReadSeq: Seq;
  readonly lastMentionSeq: Seq;
}

export const NOTHING_READ: ToolReadCursor = { lastReadSeq: 0 as Seq, lastMentionSeq: 0 as Seq };

// ---- the domain shapes of the routes (B-020 item 2, WP-682) ------------------------------------------------
// The routes speak the server's own shapes (`{messages, head, read}`, snake_case marks, `removed` rows); the
// transport (`http.ts`) maps them to these, so nothing else knows the wire.

/**
 * One page of `GET …/tools/<key>?after=<seq>&limit=<n>`: the stream after `after`, oldest first.
 * Erasure (B-005) gives a changed message a NEW seq above the head, so the page re-delivers it: `records` are
 * upserted by `id` (the older seq of the same id goes), and an id in `removed` (its author was erased) is dropped.
 */
export interface ToolPage {
  readonly records: readonly ToolRecord[];
  /** Ids of messages the server removed: the mirror drops them. */
  readonly removed: readonly string[];
  /** The highest seq on this page, removed rows included: the next `after`. 0 on an empty page. */
  readonly last: Seq;
  /** The newest seq of the stream. */
  readonly head: Seq;
  /** More follows (`last < head`): page again. */
  readonly more: boolean;
  /** The person's own read position, so a second device sees the first one's reads. */
  readonly cursor: ToolReadCursor;
  /** Everyone who has the tool, by name, as the server knows them now: the device keeps the latest list. */
  readonly members: readonly ToolMember[];
}

/** A send: `id` is minted on the device (8 to 64 letters, digits or hyphens: a UUID) and makes the send idempotent. */
export interface ToolAppend {
  readonly id: string;
  readonly body: string;
}

export type ToolAppendReply =
  | { readonly outcome: 'accepted'; readonly record: ToolRecord }
  | { readonly outcome: 'refused'; readonly code: string; readonly reason: string };

/** `POST …/tools/<key>/read`: both marks only grow on the server and never pass its head. */
export interface ToolReadMark {
  readonly seq: Seq;
  /** The highest seq up to `seq` that mentions the person (0 when none). */
  readonly mentionSeq: Seq;
}

// ---- the transport port -----------------------------------------------------------------------------------

/** What a transport answers. Anything thrown is transient (offline, 5xx, timeout): nothing is lost, retry later. */
export type ToolReply<T> =
  | { readonly kind: 'ok'; readonly value: T }
  /** 404: the tool is not available to this person (or does not exist). Not retried until the next pull. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'unauthenticated' };

export interface ToolDataTransport {
  page(tool: string, after: Seq, limit: number): Promise<ToolReply<ToolPage>>;
  append(tool: string, body: ToolAppend): Promise<ToolReply<ToolAppendReply>>;
  markRead(tool: string, mark: ToolReadMark): Promise<ToolReply<ToolReadCursor>>;
}

// ---- the device store -------------------------------------------------------------------------------------

/** A send that waits for the server. `order` is a device counter, never a clock. */
export interface OutboxEntry {
  readonly order: number;
  readonly tool: string;
  readonly id: string;
  readonly body: string;
  /** Device clock: metadata for the pending line, never an order. */
  readonly createdAt: Instant;
  /** Set when the server refused it; the entry then stays until the person retries or discards it. */
  readonly refusal?: ToolRefusal;
}

export interface ToolRefusal {
  readonly code: string;
  readonly reason: string;
}

/** A record and the tool whose stream it belongs to, as stored. */
export interface StoredToolRecord extends ToolRecord {
  readonly tool: string;
}

/** What `ctx.data.items()` lists: a mirrored record, or a send still in the outbox (`seq` null). */
export interface ToolItem {
  readonly id: string;
  /** `null` until the server accepted it. */
  readonly seq: Seq | null;
  readonly author: string;
  readonly at: Instant;
  readonly body: string;
  readonly mentions: ToolMentions;
  /** Present on a refused outbox entry. */
  readonly refusal?: ToolRefusal;
}

/** The persistence behind the store (IndexedDB in the app, memory in tests). Writes of one call are atomic. */
export interface ToolDataWrite {
  readonly records?: readonly StoredToolRecord[];
  /** Rows to remove: an id that came back under a newer seq, or was removed. */
  readonly deleteRecords?: readonly { readonly tool: string; readonly seq: Seq }[];
  /** A new outbox entry; the backend assigns its `order`. */
  readonly addOutbox?: Omit<OutboxEntry, 'order'>;
  readonly putOutbox?: readonly OutboxEntry[];
  readonly deleteOutbox?: readonly number[];
  /** `null` removes the key. */
  readonly meta?: Readonly<Record<string, ToolMeta | null>>;
}

export interface ToolDataSnapshot {
  readonly records: readonly StoredToolRecord[];
  readonly outbox: readonly OutboxEntry[];
  readonly meta: Readonly<Record<string, ToolMeta>>;
}

export interface ToolDataBackend {
  load(): Promise<ToolDataSnapshot>;
  /** Returns the `order` of `addOutbox` when there was one. */
  write(write: ToolDataWrite): Promise<{ readonly order?: number }>;
  close(): void;
}

/** Sync reads from memory (hydrated at open), async writes that commit before memory changes. */
export interface ToolDataStore {
  /** Mirrored records of one tool, ascending by seq. The array is replaced on change, never mutated. */
  records(tool: string): readonly ToolRecord[];
  /** The last seq mirrored (`after` of the next page); 0 before the first pull. */
  cursor(tool: string): Seq;
  readCursor(tool: string): ToolReadCursor;
  /** The members of the tool's stream from the last pull (empty before the first one). */
  members(tool: string): readonly ToolMember[];
  /** The highest seq the person read that the server has not been told yet. */
  pendingRead(tool: string): Seq | undefined;
  /** Bumped by every committed change of the tool's stream (records, outbox, read state): a cheap "did it change". */
  revision(tool: string): number;
  /** The tool's outbox, in creation order. */
  outbox(tool: string): readonly OutboxEntry[];
  /** Tools with a mirror, an outbox entry or a pending read. */
  tools(): readonly string[];
  /** Called after each committed change with the tool key. Returns the unsubscribe function. */
  onChange(listener: (tool: string) => void): () => void;

  /** Records (upserted by id), removals, cursor and the person's read position in one write. */
  applyPage(tool: string, page: ToolPage): Promise<void>;
  enqueue(tool: string, entry: { id: string; body: string; createdAt: Instant }): Promise<OutboxEntry>;
  /** The server accepted an entry: it leaves the outbox and its record joins the mirror, in one write. */
  confirm(tool: string, id: string, record: ToolRecord): Promise<void>;
  refuse(tool: string, id: string, refusal: ToolRefusal): Promise<void>;
  removeOutbox(tool: string, id: string): Promise<void>;
  /** Monotonic: a lower or equal seq than the stored one is ignored. */
  noteRead(tool: string, seq: Seq): Promise<void>;
  /** The server answered a read request: pending is cleared if it is covered, the cursor is stored. */
  settleRead(tool: string, sent: Seq, cursor: ToolReadCursor): Promise<void>;
  close(): void;
}

/** What a tool sees of its stream. The tool host's `ToolDataPort` is the same shape. */
export interface ToolDataHandle {
  /** Mirrored records, then pending and refused sends, oldest first. A new array at each change. */
  items(): readonly ToolItem[];
  subscribe(listener: () => void): () => void;
  /** Writes to the outbox and returns the pending item at once; the send happens in the background. */
  append(body: string): Promise<ToolItem>;
  /**
   * What the person has read: the server's answer or, until it comes, the newest mark not yet sent (so reading
   * offline clears a badge at once).
   */
  readonly cursor: ToolReadCursor;
  /** The people who have the tool, from the last pull; kept on the device, so it works offline. */
  members(): readonly ToolMember[];
  /** Batched: many calls make one request. */
  markRead(seq: Seq): void;
  /** Sends a refused item again under a new id; the old entry goes. */
  retry(id: string): Promise<ToolItem>;
  discard(id: string): Promise<void>;
}
