/**
 * The SQL of the message stream (B-020). Every statement uses an index: paging walks `messages_by_tool_seq`, the
 * mention indexes are read by `seq` range or by person / feature, read state is one primary-key row.
 */
import { mentionTokens, parseMentions, type Clock } from '@ueberblick/core';
import type { Db } from '../../db/driver';

export interface ChatMessage {
  readonly id: string;
  readonly seq: number;
  /** Null on a removed message (its author was erased). */
  readonly author: string | null;
  readonly at: string;
  /** Null on a removed message. */
  readonly body: string | null;
  /** True once the author was erased (B-005): devices drop the text and the author and keep the row. */
  readonly removed: boolean;
  readonly mentions: { readonly persons: readonly string[]; readonly features: readonly string[] };
}

export interface ReadState {
  readonly last_read_seq: number;
  readonly last_mention_seq: number;
}

export interface Appended {
  readonly message: ChatMessage;
  /** False when the client id was already stored (a replay): nothing was written. */
  readonly created: boolean;
}

/** The client id belongs to another author's message. */
export class IdTaken extends Error {
  constructor() {
    super('The message id is already used.');
  }
}

/** What an erased subject left in the stream, for the caller's counts and tests. */
export interface ChatErasure {
  readonly deleted: number;
  readonly scrubbed: number;
}

/** Placed where an erased id stood in a body; it is not a token, so it never parses as a mention. */
export const REMOVED_MARK = '[removed]';
const MAX_INDEXED = 64;

interface Row {
  seq: number;
  id: string;
  author: string;
  at: string;
  body: string;
  removed: number;
}
const COLUMNS = 'seq, id, author, at, body, removed';

export function createChatStore(db: Db, clock: Clock) {
  const byId = db.prepare<Row>(`SELECT ${COLUMNS} FROM messages WHERE id = ?`);
  const page = db.prepare<Row>(
    `SELECT ${COLUMNS} FROM messages WHERE tool = ? AND seq > ? ORDER BY seq LIMIT ?`,
  );
  const insert = db.prepare('INSERT INTO messages (id, tool, author, at, body) VALUES (?, ?, ?, ?, ?)');
  const addPerson = db.prepare('INSERT OR IGNORE INTO message_persons (seq, person_id) VALUES (?, ?)');
  const addFeature = db.prepare('INSERT OR IGNORE INTO message_features (seq, feature_id) VALUES (?, ?)');
  const personsIn = db.prepare<{ seq: number; person_id: string }>(
    'SELECT seq, person_id FROM message_persons WHERE seq BETWEEN ? AND ? ORDER BY seq, person_id',
  );
  const featuresIn = db.prepare<{ seq: number; feature_id: string }>(
    'SELECT seq, feature_id FROM message_features WHERE seq BETWEEN ? AND ? ORDER BY seq, feature_id',
  );
  const personExists = db.prepare('SELECT 1 AS x FROM participants WHERE id = ? AND hidden = 0');
  const featureExists = db.prepare('SELECT 1 AS x FROM features WHERE id = ?');
  const head = db.prepare<{ seq: number | null }>('SELECT max(seq) AS seq FROM messages WHERE tool = ?');
  const readRow = db.prepare<ReadState>(
    'SELECT last_read_seq, last_mention_seq FROM chat_reads WHERE person_id = ? AND tool = ?',
  );
  const writeRead = db.prepare(
    `INSERT INTO chat_reads (person_id, tool, last_read_seq, last_mention_seq) VALUES (?, ?, ?, ?)
     ON CONFLICT (person_id, tool) DO UPDATE SET
       last_read_seq = max(last_read_seq, excluded.last_read_seq),
       last_mention_seq = max(last_mention_seq, excluded.last_mention_seq)`,
  );

  /** Attaches the indexed mentions to rows of one seq range (two range scans, never one query per message). */
  const people = db.prepare<{ id: string; name: string | null; roles: string }>(
    'SELECT id, name, roles FROM participants WHERE hidden = 0 AND disabled_at IS NULL ORDER BY lower(coalesce(name, id)), id',
  );

  function withMentions(rows: readonly Row[]): ChatMessage[] {
    const first = rows[0];
    const last = rows[rows.length - 1];
    if (first === undefined || last === undefined) return [];
    const persons = new Map<number, string[]>();
    const features = new Map<number, string[]>();
    for (const r of personsIn.all(first.seq, last.seq)) push(persons, r.seq, r.person_id);
    for (const r of featuresIn.all(first.seq, last.seq)) push(features, r.seq, r.feature_id);
    return rows.map(({ removed, ...r }) => ({
      ...r,
      author: removed === 1 ? null : r.author,
      body: removed === 1 ? null : r.body,
      removed: removed === 1,
      mentions: { persons: persons.get(r.seq) ?? [], features: features.get(r.seq) ?? [] },
    }));
  }

  const known = (ids: readonly string[], exists: typeof personExists): string[] =>
    ids.slice(0, MAX_INDEXED).filter((id) => exists.get(id) !== undefined);

  return {
    /** Messages after `after` of one tool, oldest first, at most `limit`. */
    list(tool: string, after: number, limit: number): ChatMessage[] {
      return withMentions(page.all(tool, after, limit));
    },

    /** Every participant who is not hidden or disabled, in name order; the caller keeps those whose role has the tool. */
    participants: () => people.all(),

    /** The highest seq of the tool's stream (0 when empty). */
    head: (tool: string): number => head.get(tool)?.seq ?? 0,

    /** Stores a message once per client id; mentions are re-extracted from the body, unknown ids dropped. */
    append(tool: string, author: string, id: string, body: string): Appended {
      return db.transaction(() => {
        const old = byId.get(id);
        if (old !== undefined) {
          if (old.author !== author) throw new IdTaken();
          return { message: withMentions([old])[0] as ChatMessage, created: false };
        }
        const at = clock.now();
        const seq = Number(insert.run(id, tool, author, at, body).lastInsertRowid);
        const mentioned = parseMentions(body);
        const persons = known(mentioned.persons, personExists);
        const features = known(mentioned.features, featureExists);
        for (const p of persons) addPerson.run(seq, p);
        for (const f of features) addFeature.run(seq, f);
        return {
          message: { seq, id, author, at, body, removed: false, mentions: { persons, features } },
          created: true,
        };
      });
    },

    readState: (person: string, tool: string): ReadState =>
      readRow.get(person, tool) ?? { last_read_seq: 0, last_mention_seq: 0 },

    /** Advances the marks, never back; a mark beyond the head is cut to it (a client cannot read the future). */
    markRead(person: string, tool: string, readSeq: number, mentionSeq: number): ReadState {
      const top = head.get(tool)?.seq ?? 0;
      writeRead.run(person, tool, Math.min(readSeq, top), Math.min(mentionSeq, top));
      return this.readState(person, tool);
    },

    /** Messages a subject wrote or is mentioned in (person or feature id), in seq order, for the export. */
    *aboutSubject(subject: string): Generator<ChatMessage & { readonly via: 'author' | 'mentioned' }> {
      const seqs = db
        .prepare<{ seq: number; via: 'author' | 'mentioned' }>(
          `SELECT seq, 'author' AS via FROM messages WHERE author = ?
           UNION SELECT seq, 'mentioned' FROM message_persons WHERE person_id = ?
           UNION SELECT seq, 'mentioned' FROM message_features WHERE feature_id = ?
           ORDER BY seq`,
        )
        .all(subject, subject, subject);
      const one = db.prepare<Row>(`SELECT ${COLUMNS} FROM messages WHERE seq = ?`);
      const done = new Set<number>();
      for (const s of seqs) {
        if (done.has(s.seq)) continue;
        done.add(s.seq);
        const row = one.get(s.seq);
        if (row !== undefined) yield { ...(withMentions([row])[0] as ChatMessage), via: s.via };
      }
    },

    /**
     * Erasure of one subject (B-005), inside the erasure run's transaction. A person's own messages become removed rows
     * (author and body emptied, index rows dropped); a mention of the person or of a feature is replaced by
     * `REMOVED_MARK` in other messages' bodies and index. The person's read state is dropped. Every message that
     * changed gets a new seq above the head (a bump), so `GET ?after=` re-delivers it and devices upsert by id; a
     * second call changes nothing.
     */
    erase(subject: string): ChatErasure {
      const mine = db
        .prepare<{ seq: number }>('SELECT seq FROM messages WHERE author = ? AND removed = 0')
        .all(subject)
        .map((r) => r.seq);
      const mentioned = db
        .prepare<{ seq: number }>(
          `SELECT seq FROM message_persons WHERE person_id = ?
           UNION SELECT seq FROM message_features WHERE feature_id = ?`,
        )
        .all(subject, subject)
        .map((r) => r.seq);
      const own = new Set(mine);
      const body = db.prepare<{ body: string }>('SELECT body FROM messages WHERE seq = ?');
      const tombstone = db.prepare("UPDATE messages SET author = '', body = '', removed = 1 WHERE seq = ?");
      const setBody = db.prepare('UPDATE messages SET body = ? WHERE seq = ?');
      const nextSeq = db.prepare<{ seq: number | null }>(
        "SELECT seq FROM sqlite_sequence WHERE name = 'messages'",
      );
      const moveSeq = db.prepare('UPDATE messages SET seq = ? WHERE seq = ?');
      const setSequence = db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'messages'");
      /** Moves a message to the top of the sequence; the index rows follow (`ON UPDATE CASCADE`). */
      const bump = (seq: number): void => {
        const to = (nextSeq.get()?.seq ?? seq) + 1;
        moveSeq.run(to, seq);
        setSequence.run(to);
      };
      let deleted = 0;
      let scrubbed = 0;
      for (const seq of [...new Set([...mine, ...mentioned])].sort((a, b) => a - b)) {
        if (own.has(seq)) {
          db.prepare('DELETE FROM message_persons WHERE seq = ?').run(seq);
          db.prepare('DELETE FROM message_features WHERE seq = ?').run(seq);
          tombstone.run(seq);
          deleted++;
          bump(seq);
          continue;
        }
        const row = body.get(seq);
        if (row === undefined) continue;
        let text = row.body;
        for (const t of mentionTokens(row.body)
          .filter((x) => x.id === subject)
          .reverse())
          text = text.slice(0, t.start) + REMOVED_MARK + text.slice(t.end);
        if (text !== row.body) {
          setBody.run(text, seq);
          scrubbed++;
          bump(seq);
        }
      }
      db.prepare('DELETE FROM message_persons WHERE person_id = ?').run(subject);
      db.prepare('DELETE FROM message_features WHERE feature_id = ?').run(subject);
      db.prepare('DELETE FROM chat_reads WHERE person_id = ?').run(subject);
      return { deleted, scrubbed };
    },
  };
}
export type ChatStore = ReturnType<typeof createChatStore>;

function push(m: Map<number, string[]>, k: number, v: string): void {
  const a = m.get(k);
  if (a === undefined) m.set(k, [v]);
  else a.push(v);
}
