// WP-725 fix round 1: the choosable list is an additive column and header field; the device says which set it holds.
import { describe, expect, it } from 'vitest';
import { choosableHash } from './choosable';
import { decodePage, encodePage } from './codec';
import { SYNC_PROTOCOL_VERSION, type SyncPage } from './contract';
import { decodeRequest, encodeRequest } from './request';

const page: SyncPage = {
  header: {
    kind: 'delta',
    cursor: 5,
    head: 5,
    more: false,
    scopeFingerprint: 'abc',
    versions: { deployed: 1, live: [1] },
  },
  features: [],
  edges: [],
  observations: [],
  tombstones: [],
  runs: [],
  people: [{ id: 'p1', name: 'Anna', choosable: true }],
};

describe('choosable on the wire (additive)', () => {
  it('stays on protocol 3: the new column and header field need no bump', () => {
    expect(SYNC_PROTOCOL_VERSION).toBe(3);
  });

  it('a people table without the choosable column decodes as "no choosable info"', () => {
    const wire = JSON.parse(
      JSON.stringify(encodePage({ ...page, people: [{ id: 'p1', name: 'Anna' }] })),
    ) as {
      people: { columns: string[]; rows: unknown[][] };
    };
    wire.people = { columns: ['id', 'name'], rows: [['p1', 'Anna']] };
    expect(decodePage(wire).people).toEqual([{ id: 'p1', name: 'Anna' }]);
  });

  it('round-trips the header hash and the rows', () => {
    const withHash: SyncPage = { ...page, header: { ...page.header, choosable: choosableHash([]) } };
    expect(decodePage(JSON.parse(JSON.stringify(encodePage(withHash))))).toEqual(withHash);
    expect(decodePage(encodePage(page)).header.choosable).toBeUndefined();
  });

  it('carries the hash the device holds in the request, and drops it when empty', () => {
    const req = { since: 3, scope: 's', v: SYNC_PROTOCOL_VERSION, choosable: 'abc123' };
    expect(decodeRequest(encodeRequest(req))).toEqual(req);
    expect(encodeRequest({ ...req, choosable: '' })).not.toHaveProperty('choosable');
    expect(
      decodeRequest(encodeRequest({ since: 3, scope: 's', v: SYNC_PROTOCOL_VERSION })),
    ).not.toHaveProperty('choosable');
  });
});

describe('choosableHash', () => {
  const a = { id: 'a', name: 'Anna' };
  const b = { id: 'b', name: 'Bernd' };
  it('is empty for no one, order-free, and changes with the set or a name', () => {
    expect(choosableHash([])).toBe('');
    expect(choosableHash([a, b])).toBe(choosableHash([b, a]));
    expect(choosableHash([a, b])).not.toBe(choosableHash([a]));
    expect(choosableHash([a])).not.toBe(choosableHash([{ id: 'a', name: 'Anne' }]));
    expect(choosableHash([a])).not.toBe('');
  });
});
