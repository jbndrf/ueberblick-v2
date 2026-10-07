/**
 * Turns an HTTP answer of a run endpoint into a `RunReply` (docs/07, v3 lesson 5): only the typed envelope of
 * the endpoint schema settles a run, and only on the status that goes with its outcome (200 accepted, 422
 * refused, 409 review). A 401 is `unauthenticated`. Everything else (proxy 404, 5xx, an error envelope, a body
 * that is not JSON) is `transient`: a status code alone never refuses a run.
 * `expectedVersion` (default `SYNC_PROTOCOL_VERSION`) is the protocol version the app speaks. A body that names
 * another `v` is `incompatible` (never a refusal, never retried), and so is a body with no `v` on a status that
 * carries the envelope (200, 409, 422): since WP-144 every run reply, errors included, has a top-level `v`, so a
 * missing one is a protocol error, never silently accepted (R11). Other statuses without `v` (a proxy's 404 or
 * 5xx) stay transient.
 */
import type { Refusal } from '@ueberblick/core/model';
import { SYNC_PROTOCOL_VERSION } from '@ueberblick/core/sync';
import type { BatchResponse, RunReply, RunResponse } from './contract';

type Body = { readonly [k: string]: unknown };

const isBody = (x: unknown): x is Body => typeof x === 'object' && x !== null && !Array.isArray(x);
const isSeq = (x: unknown): boolean => isBody(x) && Number.isInteger(x['from']) && Number.isInteger(x['to']);
const isRefusal = (x: unknown): x is Refusal =>
  isBody(x) && typeof x['code'] === 'string' && typeof x['message'] === 'string';

const transient = (reason: string): RunReply => ({ kind: 'transient', reason });

function accepted(b: Body): boolean {
  if (typeof b['runId'] === 'string') return isSeq(b['seq']);
  const results = b['results'];
  return (
    isSeq(b['seq']) &&
    Array.isArray(results) &&
    results.every((r) => isBody(r) && typeof r['runId'] === 'string' && isSeq(r['seq']))
  );
}

const refused = (b: Body): boolean => typeof b['runId'] === 'string' && isRefusal(b['refusal']);

const reviewed = (b: Body): boolean =>
  typeof b['runId'] === 'string' &&
  b['reason'] === 'config_version_gone' &&
  Number.isInteger(b['configVersion']);

const ENVELOPE_STATUSES: ReadonlySet<number> = new Set([200, 409, 422]);
const OUTCOME_STATUS = { accepted: 200, refused: 422, review: 409 } as const;

export function decodeRunReply(
  status: number,
  body: unknown,
  expectedVersion: number = SYNC_PROTOCOL_VERSION,
): RunReply {
  if (status === 401) return { kind: 'unauthenticated' };
  if (!isBody(body)) return transient(`status ${status} without a typed body`);
  const v = body['v'];
  if (v === undefined) {
    if (ENVELOPE_STATUSES.has(status)) return { kind: 'incompatible', v: undefined };
    return transient(`status ${status} without a protocol version`);
  }
  if (v !== expectedVersion)
    return typeof v === 'number' ? { kind: 'incompatible', v } : transient('malformed protocol version');
  const outcome = body['outcome'];
  if (outcome !== 'accepted' && outcome !== 'refused' && outcome !== 'review')
    return transient(`status ${status} without an outcome`);
  if (OUTCOME_STATUS[outcome] !== status) return transient(`status ${status} does not match ${outcome}`);
  const valid =
    outcome === 'accepted' ? accepted(body) : outcome === 'refused' ? refused(body) : reviewed(body);
  if (!valid) return transient(`malformed ${outcome} body`);
  return { kind: 'response', response: body as unknown as RunResponse | BatchResponse };
}
