/**
 * The HTTP transport of `/api/p/<project>/tools/<key>` (B-020 item 2, WP-682). It maps the server's shapes to the
 * domain ones in `contract.ts`:
 * - `GET ?after&limit` answers `{messages, head, read: {last_read_seq, last_mention_seq}}`; a message is
 *   `{id, seq, author, at, body, removed, mentions}` (an erased author's message has `removed: true`, `body` and
 *   `author` null, and a new seq above the head).
 * - `POST {id, body}` answers `{message}` with 201 (new) or 200 (replay); 400 is `{error: {code, message}}` and a
 *   refusal; 409 means another person used the id (also a refusal: a retry mints a new id).
 * - `POST …/read {last_read_seq, last_mention_seq}` answers `{read}`.
 * - 404 means the tool is not available to the person (as for a pack file), 401 that the session ended; any other
 *   non-2xx throws and counts as transient.
 */
import type { Seq } from '@ueberblick/core/model';
import type {
  ToolAppend,
  ToolAppendReply,
  ToolDataTransport,
  ToolMember,
  ToolPage,
  ToolReadCursor,
  ToolReadMark,
  ToolRecord,
  ToolReply,
} from './contract';

interface MessageWire {
  readonly id: string;
  readonly seq: number;
  readonly author: string | null;
  readonly at: string;
  readonly body: string | null;
  readonly removed: boolean;
  readonly mentions: ToolRecord['mentions'];
}
interface ReadWire {
  readonly last_read_seq: number;
  readonly last_mention_seq: number;
}

const urlOf = (project: string, tool: string, suffix = '') =>
  `/api/p/${encodeURIComponent(project)}/tools/${encodeURIComponent(tool)}${suffix}`;

const cursorOf = (r: ReadWire): ToolReadCursor => ({
  lastReadSeq: r.last_read_seq as Seq,
  lastMentionSeq: r.last_mention_seq as Seq,
});

/** A live message always has an author and a body (null only with `removed`); anything else is a protocol violation. */
function recordOf(m: MessageWire): ToolRecord {
  if (m.author === null || m.body === null) {
    throw new Error(`tool data: live message ${m.id} has no author or body`);
  }
  return {
    id: m.id,
    seq: m.seq as Seq,
    author: m.author,
    at: m.at as ToolRecord['at'],
    body: m.body,
    mentions: m.mentions,
  };
}

export function httpToolDataTransport(project: string, fetchFn: typeof fetch = fetch): ToolDataTransport {
  const common = { credentials: 'same-origin' } as const;
  const json = { 'content-type': 'application/json' };

  /** Maps the statuses every route shares; returns undefined for the route's own handling. */
  const shared = (res: Response): ToolReply<never> | undefined => {
    if (res.status === 401) return { kind: 'unauthenticated' };
    if (res.status === 404) return { kind: 'unavailable' };
    return undefined;
  };
  const refusal = async (res: Response): Promise<ToolAppendReply> => {
    const b = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    return { outcome: 'refused', code: b.error?.code ?? 'refused', reason: b.error?.message ?? '' };
  };

  return {
    async page(tool, after, limit) {
      const res = await fetchFn(urlOf(project, tool) + `?after=${after}&limit=${limit}`, common);
      const known = shared(res);
      if (known) return known;
      if (!res.ok) throw new Error(`tool data: HTTP ${res.status}`);
      const w = (await res.json()) as {
        messages: MessageWire[];
        head: number;
        read: ReadWire;
        members?: ToolMember[];
      };
      const live = w.messages.filter((m) => !m.removed);
      const last = (w.messages[w.messages.length - 1]?.seq ?? 0) as Seq;
      const page: ToolPage = {
        records: live.map(recordOf),
        removed: w.messages.filter((m) => m.removed).map((m) => m.id),
        last,
        head: w.head as Seq,
        more: w.messages.length > 0 && last < w.head,
        cursor: cursorOf(w.read),
        members: (w.members ?? []).map((m) => ({ id: m.id, name: m.name })),
      };
      return { kind: 'ok', value: page };
    },
    async append(tool, body: ToolAppend): Promise<ToolReply<ToolAppendReply>> {
      const res = await fetchFn(urlOf(project, tool), {
        ...common,
        method: 'POST',
        headers: json,
        body: JSON.stringify(body),
      });
      const known = shared(res);
      if (known) return known;
      if (res.status === 400 || res.status === 409) return { kind: 'ok', value: await refusal(res) };
      if (!res.ok) throw new Error(`tool data: HTTP ${res.status}`);
      const w = (await res.json()) as { message: MessageWire };
      return { kind: 'ok', value: { outcome: 'accepted', record: recordOf(w.message) } };
    },
    async markRead(tool, mark: ToolReadMark): Promise<ToolReply<ToolReadCursor>> {
      const res = await fetchFn(urlOf(project, tool, '/read'), {
        ...common,
        method: 'POST',
        headers: json,
        body: JSON.stringify({ last_read_seq: mark.seq, last_mention_seq: mark.mentionSeq }),
      });
      const known = shared(res);
      if (known) return known;
      if (!res.ok) throw new Error(`tool data: HTTP ${res.status}`);
      return { kind: 'ok', value: cursorOf(((await res.json()) as { read: ReadWire }).read) };
    },
  };
}
