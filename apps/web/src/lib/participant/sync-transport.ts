/**
 * The sync page transport: `GET /api/p/<project>/sync` as text, judged by the typed codes of `core/sync`. It runs in
 * the sync worker (WP-567) as well as in-thread, so it imports only types from `@ueberblick/client`.
 */
import type { EncodedSyncTransport, PagePayload } from '@ueberblick/client';
import {
  SYNC_ERROR_CODES,
  SyncProtocolError,
  type SyncErrorCode,
  type SyncRequest,
} from '@ueberblick/core/sync';
import { json, type FetchLike } from './http';

const isSyncCode = (x: unknown): x is SyncErrorCode =>
  typeof x === 'string' && (SYNC_ERROR_CODES.keys as readonly string[]).includes(x);

/** The failure text of a 401: the sync worker passes only the text on, `session-end.ts` recognises it. */
export const SYNC_UNAUTHENTICATED = 'sync answered 401';

/** One sync page as the server sends it (the browser has already gunzipped it): the text, decoded later. */
export function createEncodedSyncTransport(project: string, fetch: FetchLike): EncodedSyncTransport {
  return {
    async fetchEncoded(req: SyncRequest): Promise<PagePayload> {
      const q = new URLSearchParams({ since: String(req.since), scope: req.scope, v: String(req.v) });
      if (req.after !== undefined) q.set('after', String(req.after));
      if (req.pin !== undefined) q.set('pin', String(req.pin));
      if (req.limit !== undefined) q.set('limit', String(req.limit));
      if (req.choosable !== undefined && req.choosable !== '') q.set('choosable', req.choosable);
      const res = await fetch(`/api/p/${project}/sync?${q}`);
      if (res.ok) return res.text();
      if (res.status === 401) throw new Error(SYNC_UNAUTHENTICATED);
      const body = (await json(res)) as { code?: unknown; error?: unknown } | undefined;
      if ((res.status === 409 || res.status === 400) && isSyncCode(body?.code))
        throw new SyncProtocolError(body.code, String(body.error ?? body.code));
      throw new Error(`sync answered ${res.status}`);
    },
  };
}
