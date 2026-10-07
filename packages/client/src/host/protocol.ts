/**
 * The message protocol between the main thread and the sync worker (B-012, WP-567). CONTRACT: changes need the lead.
 *
 * CONTRACT change approved by lead-b (WP-669): protocol 2 adds the worker-to-main message `versions`: each page
 * header's `versions` (`completed: false`) and, once per completed pull, the last header's (`completed: true`). The
 * main thread, where `ConfigVersions` lives, follows the first and prunes on the second.
 *
 * Typed and versioned; there is no fallback (R11): a message of another version, of an unknown kind or with
 * ill-typed fields is refused with a `HostProtocolError`, never ignored or defaulted. The kind tags are internal
 * wire tags, not domain values. Validation of the small messages is complete; the row arrays inside a page
 * commit are checked for shape only, so the cost on the main thread stays O(1) per page (R14).
 */
import { SYNC_ERROR_CODES, SYNC_PAGE_KINDS, SyncProtocolError } from '@ueberblick/core/sync';
import type { SyncVersions } from '@ueberblick/core/sync';
import type { SyncResetReason } from '@ueberblick/core/registry';
import {
  STORE_ERROR_CODES,
  SYNC_FAILURE_KINDS,
  SYNC_PHASES,
  SYNC_RESET_REASONS,
} from '@ueberblick/core/registry';
import { DeviceStoreError } from '../store/codes';
import { COMMIT_KINDS, type CommitNotice, type StoreCommit } from '../store/commit';
import type { StoredCursor, StoreIssue } from '../store/contract';
import type { PullResult, SyncFailure, SyncStatus } from '../sync/contract';
import { classify } from '../sync/worker';

export const HOST_PROTOCOL_VERSION = 2;

export const TO_WORKER_KINDS = ['init', 'start', 'pull', 'rederived', 'close'] as const;
export const FROM_WORKER_KINDS = [
  'ready',
  'pulled',
  'status',
  'change',
  'rederive',
  'issue',
  'versions',
  'fault',
] as const;

export const HOST_ERROR_CODES = [
  'bad_version',
  'unknown_kind',
  'ill_typed',
  'out_of_order',
  'replica_diverged',
] as const;
export type HostErrorCode = (typeof HOST_ERROR_CODES)[number];

export class HostProtocolError extends Error {
  constructor(
    readonly code: HostErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HostProtocolError';
  }
}

/** A failure as it travels: rebuilt as `SyncProtocolError`, `DeviceStoreError` or a plain `Error` on arrival. */
export type WireError = SyncFailure;

export type ToWorker =
  | {
      readonly v: number;
      readonly kind: 'init';
      readonly name: string;
      readonly config: Readonly<Record<string, string>>;
    }
  | { readonly v: number; readonly kind: 'start' }
  | { readonly v: number; readonly kind: 'pull'; readonly id: number }
  | { readonly v: number; readonly kind: 'rederived'; readonly id: number; readonly error?: WireError }
  | { readonly v: number; readonly kind: 'close' };

export type FromWorker =
  | { readonly v: number; readonly kind: 'ready'; readonly cursor: StoredCursor | undefined }
  | {
      readonly v: number;
      readonly kind: 'pulled';
      readonly id: number;
      readonly result?: PullResult;
      readonly error?: WireError;
    }
  | { readonly v: number; readonly kind: 'status'; readonly status: SyncStatus }
  | { readonly v: number; readonly kind: 'change'; readonly notice: CommitNotice }
  | { readonly v: number; readonly kind: 'rederive'; readonly id: number; readonly reason: SyncResetReason }
  | { readonly v: number; readonly kind: 'issue'; readonly issue: StoreIssue }
  | {
      readonly v: number;
      readonly kind: 'versions';
      readonly versions: SyncVersions;
      /** `false`: a page header arrived. `true`: a pull completed (the last header's versions). */
      readonly completed: boolean;
    }
  | { readonly v: number; readonly kind: 'fault'; readonly message: string };

/** A message without its envelope version (`post` adds it). */
export type Body<M> = M extends unknown ? Omit<M, 'v'> : never;

const bad = (message: string): never => {
  throw new HostProtocolError('ill_typed', message);
};

type Rec = Record<string, unknown>;

function envelope(raw: unknown, kinds: readonly string[]): Rec {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return bad('a message is an object');
  const m = raw as Rec;
  if (m['v'] !== HOST_PROTOCOL_VERSION)
    throw new HostProtocolError(
      'bad_version',
      `the message speaks host protocol ${String(m['v'])}, this side speaks ${HOST_PROTOCOL_VERSION}`,
    );
  const kind = m['kind'];
  if (typeof kind !== 'string' || !kinds.includes(kind))
    throw new HostProtocolError('unknown_kind', `unknown message kind ${JSON.stringify(kind)}`);
  return m;
}

const str = (m: Rec, k: string): string =>
  typeof m[k] === 'string' ? (m[k] as string) : bad(`${String(m['kind'])}.${k} must be a string`);
const int = (m: Rec, k: string): number =>
  Number.isInteger(m[k]) ? (m[k] as number) : bad(`${String(m['kind'])}.${k} must be an integer`);
const obj = (m: Rec, k: string): Rec =>
  typeof m[k] === 'object' && m[k] !== null && !Array.isArray(m[k])
    ? (m[k] as Rec)
    : bad(`${String(m['kind'])}.${k} must be an object`);
const arr = (m: Rec, k: string): readonly unknown[] =>
  Array.isArray(m[k]) ? (m[k] as unknown[]) : bad(`${String(m['kind'])}.${k} must be an array`);

function cursorOf(o: Rec): StoredCursor {
  const kind = o['kind'];
  if (
    typeof kind !== 'string' ||
    !SYNC_PAGE_KINDS.has(kind) ||
    typeof o['cursor'] !== 'number' ||
    typeof o['scopeFingerprint'] !== 'string'
  )
    return bad('a cursor is { kind, cursor, scopeFingerprint }');
  return { kind, cursor: o['cursor'], scopeFingerprint: o['scopeFingerprint'] };
}

const optCursor = (m: Rec, k: string): StoredCursor | undefined =>
  m[k] === undefined ? undefined : cursorOf(obj(m, k));

function wireError(m: Rec, k: string): WireError | undefined {
  if (m[k] === undefined) return undefined;
  const e = obj(m, k);
  const kind = str(e, 'kind');
  if (!SYNC_FAILURE_KINDS.has(kind)) return bad('an error has a known kind');
  return {
    kind,
    code: e['code'] === undefined ? undefined : str(e, 'code'),
    message: str(e, 'message'),
  };
}

function partOf(o: Rec): { index: number; count: number } {
  const index = int(o, 'index');
  const count = int(o, 'count');
  return index >= 0 && index < count ? { index, count } : bad('a slice index lies inside its count');
}

function commitOf(o: Rec): StoreCommit {
  const kind = o['kind'];
  if (typeof kind !== 'string' || !(COMMIT_KINDS as readonly string[]).includes(kind))
    throw new HostProtocolError('unknown_kind', `unknown commit kind ${JSON.stringify(kind)}`);
  if (kind === 'page') {
    const plan = obj(o, 'plan');
    for (const k of ['featurePuts', 'featureDeletes', 'edgePuts', 'edgeDeletes', 'historyPuts']) arr(plan, k);
    cursorOf(obj(o, 'cursor'));
    return o as unknown as StoreCommit;
  }
  if (kind === 'history_dropped') {
    str(o, 'featureId');
    arr(o, 'properties');
  } else if (kind === 'blob_purge') {
    for (const id of arr(o, 'ids')) if (typeof id !== 'string') bad('blob_purge.ids must be strings');
  }
  return o as unknown as StoreCommit;
}

export function parseToWorker(raw: unknown): ToWorker {
  const m = envelope(raw, TO_WORKER_KINDS);
  switch (m['kind']) {
    case 'init': {
      const config = obj(m, 'config');
      for (const [k, v] of Object.entries(config))
        if (typeof v !== 'string') bad(`init.config.${k} must be a string`);
      return {
        v: HOST_PROTOCOL_VERSION,
        kind: 'init',
        name: str(m, 'name'),
        config: config as Record<string, string>,
      };
    }
    case 'pull':
      return { v: HOST_PROTOCOL_VERSION, kind: 'pull', id: int(m, 'id') };
    case 'rederived': {
      const error = wireError(m, 'error');
      return { v: HOST_PROTOCOL_VERSION, kind: 'rederived', id: int(m, 'id'), ...(error ? { error } : {}) };
    }
    default:
      return { v: HOST_PROTOCOL_VERSION, kind: m['kind'] as 'start' | 'close' };
  }
}

export function parseFromWorker(raw: unknown): FromWorker {
  const m = envelope(raw, FROM_WORKER_KINDS);
  switch (m['kind']) {
    case 'ready':
      return { v: HOST_PROTOCOL_VERSION, kind: 'ready', cursor: optCursor(m, 'cursor') };
    case 'pulled': {
      const error = wireError(m, 'error');
      if (m['result'] === undefined && !error) bad('pulled needs a result or an error');
      if (m['result'] === undefined)
        return { v: HOST_PROTOCOL_VERSION, kind: 'pulled', id: int(m, 'id'), error: error as WireError };
      const r = obj(m, 'result');
      int(r, 'pages');
      return {
        v: HOST_PROTOCOL_VERSION,
        kind: 'pulled',
        id: int(m, 'id'),
        result: r as unknown as PullResult,
      };
    }
    case 'status': {
      const s = obj(m, 'status');
      if (!SYNC_PHASES.has(str(s, 'phase'))) bad('status.phase is not a sync phase');
      int(s, 'featuresLoaded');
      return { v: HOST_PROTOCOL_VERSION, kind: 'status', status: s as unknown as SyncStatus };
    }
    case 'change': {
      const n = obj(m, 'notice');
      return {
        v: HOST_PROTOCOL_VERSION,
        kind: 'change',
        notice: {
          from: optCursor(n, 'from'),
          commit: commitOf(obj(n, 'commit')),
          ...(n['part'] === undefined ? {} : { part: partOf(obj(n, 'part')) }),
        },
      };
    }
    case 'rederive': {
      const reason = str(m, 'reason');
      if (!SYNC_RESET_REASONS.has(reason)) bad('rederive.reason is not a reset reason');
      return {
        v: HOST_PROTOCOL_VERSION,
        kind: 'rederive',
        id: int(m, 'id'),
        reason: reason as SyncResetReason,
      };
    }
    case 'issue': {
      const i = obj(m, 'issue');
      if (!STORE_ERROR_CODES.has(str(i, 'code'))) bad('issue.code is not a store error code');
      return { v: HOST_PROTOCOL_VERSION, kind: 'issue', issue: i as unknown as StoreIssue };
    }
    case 'versions': {
      const v = obj(m, 'versions');
      const live = arr(v, 'live');
      if (!live.every((n) => Number.isInteger(n))) bad('versions.live must be integers');
      if (typeof m['completed'] !== 'boolean') bad('versions.completed must be a boolean');
      return {
        v: HOST_PROTOCOL_VERSION,
        kind: 'versions',
        versions: { deployed: int(v, 'deployed'), live: live as number[] },
        completed: m['completed'] as boolean,
      };
    }
    default:
      return { v: HOST_PROTOCOL_VERSION, kind: 'fault', message: str(m, 'message') };
  }
}

/** A thrown value as it travels. */
export const toWire = (error: unknown): WireError => classify(error);

/** The typed error again; an unknown code is itself an error, never a silent plain `Error`. */
export function fromWire(w: WireError): Error {
  if (w.kind === 'protocol') {
    if (w.code !== undefined && SYNC_ERROR_CODES.has(w.code)) return new SyncProtocolError(w.code, w.message);
    return new HostProtocolError('ill_typed', `unknown protocol error code ${String(w.code)}: ${w.message}`);
  }
  if (w.kind === 'store') {
    if (w.code !== undefined && STORE_ERROR_CODES.has(w.code)) return new DeviceStoreError(w.code, w.message);
    return new HostProtocolError('ill_typed', `unknown store error code ${String(w.code)}: ${w.message}`);
  }
  return new Error(w.message);
}
