/**
 * Page decoding off the main thread (docs/07, docs/12 "long task during sync", WP-514).
 *
 * `decodePayload` is the one decode step (JSON parse when the payload is text, `core.decodePage`, page cap).
 * It runs inside a worker (`serveDecoder`) or inline (`inlineDecoder`, tests and hosts without workers).
 * The main thread only posts the payload, receives the decoded page and applies it.
 */
import { SYNC_ERROR_CODES, SyncProtocolError, decodePage } from '@ueberblick/core/sync';
import type { EncodedPage, SyncErrorCode, SyncPage, SyncRequest } from '@ueberblick/core/sync';
import type { SyncTransport } from './contract';

/**
 * Feature rows a page may carry, and the cap the device asks the server for. A page of this size decodes in
 * about 84 ms on the throttled profile (lead-a's measure), which is the whole main-thread budget (docs/12) if it
 * ran there; in a worker only the structured-clone hand-back and `applyPage` stay on the main thread.
 */
export const SYNC_PAGE_MAX_ROWS = 1000;

/** A page as the HTTP adapter got it: parsed tuples, or the raw JSON text (parsed in the worker). */
export type PagePayload = EncodedPage | string;

export interface PageDecoder {
  decode(payload: PagePayload, maxRows: number): Promise<SyncPage>;
}

/** The HTTP port for a raw page. The request already carries the page cap as `limit` (`SyncRequest.limit`; the server may send fewer). */
export interface EncodedSyncTransport {
  fetchEncoded(request: SyncRequest): Promise<PagePayload>;
}

export function decodePayload(payload: PagePayload, maxRows: number): SyncPage {
  let parsed: unknown = payload;
  if (typeof payload === 'string') {
    try {
      parsed = JSON.parse(payload);
    } catch {
      throw new SyncProtocolError('malformed', 'the page is not valid JSON');
    }
  }
  const page = decodePage(parsed);
  if (page.features.length > maxRows)
    throw new SyncProtocolError(
      'malformed',
      `the page has ${page.features.length} feature rows, the cap is ${maxRows}`,
    );
  return page;
}

export const inlineDecoder: PageDecoder = {
  decode: (payload, maxRows) => {
    try {
      return Promise.resolve(decodePayload(payload, maxRows));
    } catch (e) {
      return Promise.reject(e);
    }
  },
};

/** Composes a `SyncTransport` for the sync worker: request with the cap, decode with the decoder. */
export function decodingTransport(
  encoded: EncodedSyncTransport,
  decoder: PageDecoder,
  maxRows: number = SYNC_PAGE_MAX_ROWS,
): SyncTransport {
  return {
    async fetchPage(request) {
      return decoder.decode(await encoded.fetchEncoded({ ...request, limit: maxRows }), maxRows);
    },
  };
}

/** The slice of `MessagePort` / `Worker` / `self` the decoder protocol uses. */
export interface MessagePortLike {
  postMessage(message: unknown): void;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
}

interface DecodeRequest {
  readonly id: number;
  readonly payload: PagePayload;
  readonly maxRows: number;
}
type DecodeReply =
  | { readonly id: number; readonly page: SyncPage }
  | { readonly id: number; readonly code: string; readonly message: string }
  /** Anything that is not a `SyncProtocolError`: a bug in the worker, never a protocol answer. */
  | { readonly id: number; readonly fault: string };

const isSyncCode = (code: string): code is SyncErrorCode => SYNC_ERROR_CODES.has(code);

/** Runs inside the worker: answers each request with the decoded page or the typed error. */
export function serveDecoder(port: MessagePortLike): void {
  port.onmessage = (event) => {
    const { id, payload, maxRows } = event.data as DecodeRequest;
    try {
      port.postMessage({ id, page: decodePayload(payload, maxRows) } satisfies DecodeReply);
    } catch (e) {
      port.postMessage(
        (e instanceof SyncProtocolError
          ? { id, code: e.code, message: e.message }
          : { id, fault: e instanceof Error ? e.message : String(e) }) satisfies DecodeReply,
      );
    }
  };
}

/** Main-thread side: requests are matched to replies by id, a typed error is rebuilt as `SyncProtocolError`. */
export function createWorkerDecoder(port: MessagePortLike): PageDecoder {
  let next = 1;
  const waiting = new Map<number, { resolve: (p: SyncPage) => void; reject: (e: unknown) => void }>();
  port.onmessage = (event) => {
    const reply = event.data as DecodeReply;
    const w = waiting.get(reply.id);
    if (!w) return;
    waiting.delete(reply.id);
    if ('page' in reply) w.resolve(reply.page);
    else if ('fault' in reply) w.reject(new Error(`the decode worker failed: ${reply.fault}`));
    else if (isSyncCode(reply.code)) w.reject(new SyncProtocolError(reply.code, reply.message));
    else
      w.reject(new Error(`the decode worker sent an unknown error code \`${reply.code}\`: ${reply.message}`));
  };
  return {
    decode(payload, maxRows) {
      return new Promise((resolve, reject) => {
        const id = next++;
        waiting.set(id, { resolve, reject });
        try {
          port.postMessage({ id, payload, maxRows } satisfies DecodeRequest);
        } catch (e) {
          waiting.delete(id);
          reject(e);
        }
      });
    },
  };
}
