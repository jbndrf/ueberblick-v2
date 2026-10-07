import type { SyncRequest } from './contract';
import { SYNC_PROTOCOL_VERSION } from './contract';
import { SyncProtocolError } from './errors';

/** Query parameters of `GET /sync`. */
export function encodeRequest(req: SyncRequest): Record<string, string> {
  return {
    since: String(req.since),
    scope: req.scope,
    v: String(req.v),
    ...(req.after === undefined ? {} : { after: String(req.after) }),
    ...(req.pin === undefined ? {} : { pin: String(req.pin) }),
    ...(req.limit === undefined ? {} : { limit: String(req.limit) }),
    ...(req.choosable === undefined || req.choosable === '' ? {} : { choosable: req.choosable }),
  };
}

function optionalSeq(value: string | undefined, name: string): Record<string, number> {
  if (value === undefined) return {};
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0)
    throw new SyncProtocolError('malformed', `${name} must be a non-negative integer`);
  return { [name]: n };
}

function optionalLimit(value: string | undefined): Record<string, number> {
  if (value === undefined) return {};
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1)
    throw new SyncProtocolError('malformed', 'limit must be a positive integer');
  return { limit: n };
}

/** Parses the query of `GET /sync`; a version other than ours is a `version_mismatch` error. */
export function decodeRequest(query: Readonly<Record<string, string | undefined>>): SyncRequest {
  const v = Number(query.v);
  if (!Number.isInteger(v) || v !== SYNC_PROTOCOL_VERSION)
    throw new SyncProtocolError(
      'version_mismatch',
      `protocol version ${String(query.v)} received, ${SYNC_PROTOCOL_VERSION} supported`,
    );
  const since = Number(query.since);
  if (!Number.isInteger(since) || since < 0)
    throw new SyncProtocolError('malformed', 'since must be a non-negative integer');
  return {
    since,
    scope: query.scope ?? '',
    v,
    ...optionalSeq(query.after, 'after'),
    ...optionalSeq(query.pin, 'pin'),
    ...optionalLimit(query.limit),
    ...(query.choosable === undefined || query.choosable === '' ? {} : { choosable: query.choosable }),
  };
}
