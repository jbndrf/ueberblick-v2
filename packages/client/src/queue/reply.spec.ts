// WP-511: only a typed envelope settles a run; everything else is transient (docs/07, v3 lesson 5).
import { describe, expect, it } from 'vitest';
import { SYNC_PROTOCOL_VERSION } from '@ueberblick/core/sync';
import { decodeRunReply } from './reply';

const seq = { from: 1, to: 1 };
const accepted = { outcome: 'accepted', runId: 'r1', seq, observations: [] };
const refused = {
  outcome: 'refused',
  runId: 'r1',
  refusal: { code: 'constraint_failed', message: 'm', path: 'form.x' },
};
const review = { outcome: 'review', runId: 'r1', reason: 'config_version_gone', configVersion: 3 };

// every run reply carries the protocol version (WP-144)
const withV = (b: unknown): unknown =>
  typeof b === 'object' && b !== null ? { ...b, v: SYNC_PROTOCOL_VERSION } : b;

describe('decodeRunReply', () => {
  it.each([
    [200, accepted],
    [422, refused],
    [409, review],
    [200, { outcome: 'accepted', results: [{ runId: 'r1', seq }], seq }],
    [422, { outcome: 'refused', index: 1, runId: 'r2', refusal: { code: 'not_permitted', message: 'm' } }],
  ])('%i with a typed body settles', (status, body) => {
    expect(decodeRunReply(status, withV(body))).toEqual({ kind: 'response', response: withV(body) });
  });

  it('a 401 is unauthenticated', () => {
    expect(decodeRunReply(401, { error: { code: 'unauthenticated' } })).toEqual({ kind: 'unauthenticated' });
  });

  it.each([
    ['a proxy 404', 404, '<html>not found</html>'],
    ['a 502', 502, null],
    ['a 500 with a json body', 500, { error: { code: 'internal' } }],
    ['a 422 that is not the envelope', 422, { error: { code: 'validation' } }],
    ['a 409 version_mismatch', 409, { error: { code: 'version_mismatch' } }],
    ['a 403', 403, { error: { code: 'forbidden' } }],
    ['a refusal body without a code', 422, { outcome: 'refused', runId: 'r', refusal: { message: 'x' } }],
    ['an accepted body on a 422', 422, accepted],
    ['a refused body on a 200', 200, refused],
    ['a body that is not an object', 200, 'ok'],
  ])('%s is transient, never a refusal', (_n, status, body) => {
    expect(decodeRunReply(status, withV(body)).kind).toBe('transient');
  });

  it('another protocol version is incompatible: not transient, not a refusal, on any status', () => {
    expect(decodeRunReply(422, { ...refused, v: SYNC_PROTOCOL_VERSION + 1 })).toEqual({
      kind: 'incompatible',
      v: SYNC_PROTOCOL_VERSION + 1,
    });
    expect(decodeRunReply(200, { ...accepted, v: 0 })).toEqual({ kind: 'incompatible', v: 0 });
    expect(decodeRunReply(409, { error: { code: 'version_mismatch' }, v: 9 }, 1)).toEqual({
      kind: 'incompatible',
      v: 9,
    });
    expect(decodeRunReply(422, { ...refused, v: 'x' }).kind).toBe('transient');
  });

  it('the expected version defaults to SYNC_PROTOCOL_VERSION; a matching v settles', () => {
    expect(decodeRunReply(422, { ...refused, v: SYNC_PROTOCOL_VERSION }).kind).toBe('response');
    expect(decodeRunReply(422, { ...refused, v: 1 }, 1).kind).toBe('response');
  });

  it('a reply without v is a protocol error on the envelope statuses (WP-144), transient elsewhere', () => {
    for (const [status, body] of [
      [200, { outcome: 'accepted', runId: 'r1', seq }],
      [422, { outcome: 'refused', runId: 'r1', refusal: { code: 'x', message: 'm' } }],
      [409, { outcome: 'review', runId: 'r1', reason: 'config_version_gone', configVersion: 3 }],
      [409, { error: { code: 'no_config' } }],
    ] as const)
      expect(decodeRunReply(status, body)).toEqual({ kind: 'incompatible', v: undefined });
    expect(decodeRunReply(502, { error: 'bad gateway' }).kind).toBe('transient');
    expect(decodeRunReply(404, { message: 'no' }).kind).toBe('transient');
  });
});
