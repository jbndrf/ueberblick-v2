import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FeatureId, Json, Key, RunId } from '../model';
import {
  SYNC_COLUMNS,
  SYNC_OBSERVATION_HISTORY,
  SYNC_PAGE_KINDS,
  SYNC_PROTOCOL_VERSION,
  SYNC_TOMBSTONE_KINDS,
  SyncProtocolError,
  decodePage,
  decodeRequest,
  encodePage,
  encodeRequest,
  scopeFingerprint,
  type SyncPage,
} from './index';

const json: fc.Arbitrary<Json> = fc.jsonValue().map((v) => JSON.parse(JSON.stringify(v)) as Json);
const rec = fc.dictionary(fc.string({ minLength: 1 }), json, { noNullPrototype: true });
const seq = fc.nat({ max: 2 ** 40 });
const fid = fc.uuid().map((s) => s as FeatureId);

export const pageArb: fc.Arbitrary<SyncPage> = fc.record({
  header: fc.record({
    kind: fc.constantFrom(...SYNC_PAGE_KINDS.keys),
    cursor: seq,
    head: seq,
    more: fc.boolean(),
    scopeFingerprint: fc.string(),
    versions: fc.tuple(fc.nat(9), fc.uniqueArray(fc.nat(9), { maxLength: 3 })).map(([deployed, others]) => ({
      deployed,
      live: [...new Set([deployed, ...others])].sort((a, b) => a - b),
    })),
  }),
  features: fc.array(
    fc.record({
      id: fid,
      type: fc.constantFrom('tree' as Key, 'defect' as Key),
      version: fc.nat(9),
      properties: rec,
      lifecycle: fc.constantFrom('active', 'completed'),
      updatedSeq: seq,
    }),
    { maxLength: 6 },
  ),
  edges: fc.array(
    fc.record({
      from: fid,
      relation: fc.constant('in' as Key),
      to: fid,
      derived: fc.boolean(),
      updatedSeq: seq,
    }),
    { maxLength: 6 },
  ),
  observations: fc.array(
    fc.record({
      featureId: fid,
      property: fc.string({ minLength: 1 }),
      result: json,
      phenomenonTime: fc.oneof(fc.constant(null), fc.string()),
      resultTime: fc.oneof(fc.constant(null), fc.string()),
      seq,
      runId: fc.uuid().map((s) => s as RunId),
    }),
    { maxLength: 6 },
  ),
  tombstones: fc.array(
    fc.record({ seq, kind: fc.constantFrom(...SYNC_TOMBSTONE_KINDS.keys), id: fc.string() }),
    { maxLength: 6 },
  ),
  runs: fc.array(
    fc.record({
      id: fc.uuid().map((s) => s as RunId),
      task: fc.string({ minLength: 1 }),
      actor: fc.oneof(fc.constant(null), fc.string({ minLength: 1 })),
      clientTime: fc.oneof(fc.constant(null), seq),
      receivedAt: seq,
      seq,
      causedBy: fc.oneof(
        fc.constant(null),
        fc.uuid().map((s) => s as RunId),
      ),
    }),
    { maxLength: 6 },
  ),
  people: fc.array(
    fc.oneof(
      fc.record({ id: fc.string({ minLength: 1 }), name: fc.string() }),
      fc.record({ id: fc.string({ minLength: 1 }), name: fc.string(), choosable: fc.constant(true) }),
    ),
    { maxLength: 6 },
  ),
});

const emptyPage: SyncPage = {
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
  people: [],
};

describe('page codec', () => {
  it('round-trips arbitrary pages', () => {
    fc.assert(
      fc.property(pageArb, (page) => {
        expect(decodePage(encodePage(page))).toEqual(page);
      }),
    );
  });

  it('round-trips through JSON text with Z coordinates intact (H1)', () => {
    const geometry = { type: 'Point', coordinates: [13.4, 52.5, 34.25] };
    const page: SyncPage = {
      ...emptyPage,
      features: [
        {
          id: 'f1' as FeatureId,
          type: 'tree' as Key,
          version: 1,
          properties: { geometry },
          lifecycle: 'active',
          updatedSeq: 3,
        },
      ],
      observations: [
        {
          featureId: 'f1' as FeatureId,
          property: 'geometry',
          result: geometry,
          phenomenonTime: null,
          resultTime: null,
          seq: 3,
          runId: 'r1' as RunId,
        },
      ],
    };
    const back = decodePage(JSON.parse(JSON.stringify(encodePage(page))));
    expect(back).toEqual(page);
    expect(back.features[0]?.properties.geometry).toEqual(geometry);
  });

  it('emits columns in canonical order, once per table', () => {
    const page = encodePage(emptyPage);
    expect(page.features.columns).toEqual(SYNC_COLUMNS.features);
    expect(page.observations.columns).toEqual(SYNC_COLUMNS.observations);
    expect(page.v).toBe(SYNC_PROTOCOL_VERSION);
  });

  it('ignores unknown extra columns: same value as without them (property)', () => {
    fc.assert(
      fc.property(pageArb, fc.nat({ max: 4 }), json, (page, at, filler) => {
        const wire = JSON.parse(JSON.stringify(encodePage(page))) as Record<
          string,
          { columns: string[]; rows: unknown[][] }
        >;
        for (const t of ['features', 'edges', 'observations', 'tombstones']) {
          const table = wire[t] as { columns: string[]; rows: unknown[][] };
          const pos = Math.min(at, table.columns.length);
          table.columns.splice(pos, 0, 'futureColumn');
          for (const r of table.rows) r.splice(pos, 0, filler);
        }
        expect(decodePage(wire)).toEqual(page);
      }),
    );
  });

  it('rejects a missing known column with a typed error', () => {
    const wire = JSON.parse(JSON.stringify(encodePage(emptyPage))) as Record<
      string,
      { columns: string[]; rows: unknown[] }
    >;
    const edges = wire.edges as { columns: string[]; rows: unknown[] };
    edges.columns = ['from', 'relation', 'extra'];
    expect(() => decodePage(wire)).toThrowError(expect.objectContaining({ code: 'missing_column' }));
  });

  it('decodes by column name when a complete list is reordered', () => {
    const page: SyncPage = { ...emptyPage, tombstones: [{ seq: 9, kind: 'feature', id: 'x' }] };
    const wire = encodePage(page);
    const swapped = { ...wire, tombstones: { columns: ['id', 'kind', 'seq'], rows: [['x', 'feature', 9]] } };
    expect(decodePage(swapped)).toEqual(page);
  });

  it('rejects a version mismatch with a typed error', () => {
    const wire = { ...encodePage(emptyPage), v: SYNC_PROTOCOL_VERSION + 1 };
    expect(() => decodePage(wire)).toThrowError(SyncProtocolError);
    expect(() => decodePage(wire)).toThrowError(expect.objectContaining({ code: 'version_mismatch' }));
  });

  describe('protocol 3 refusals', () => {
    type Wire = { header: Record<string, unknown>; features: { columns: string[]; rows: unknown[][] } };
    const feature = {
      id: 'f1',
      type: 'baum',
      version: 1,
      properties: {},
      lifecycle: 'active',
      createdBy: null,
      createdAt: null,
      changedAt: null,
      updatedSeq: 1,
    } as unknown as SyncPage['features'][number];
    const wireOf = (): Wire =>
      JSON.parse(JSON.stringify(encodePage({ ...emptyPage, features: [feature] }))) as Wire;
    const refused = (wire: Wire, code: string): void =>
      expect(() => decodePage(wire)).toThrowError(expect.objectContaining({ code }));

    it('refuses a header without versions, with a non-object versions, or a non-numeric deployed', () => {
      const a = wireOf();
      delete a.header['versions'];
      refused(a, 'malformed');
      const b = wireOf();
      b.header['versions'] = 'x';
      refused(b, 'malformed');
      const c = wireOf();
      c.header['versions'] = { deployed: '1', live: [1] };
      refused(c, 'malformed');
    });

    it('refuses a non-numeric live entry and a live set without the deployed version', () => {
      const a = wireOf();
      a.header['versions'] = { deployed: 1, live: ['x'] };
      refused(a, 'malformed');
      const b = wireOf();
      b.header['versions'] = { deployed: 1, live: [2, 3] };
      refused(b, 'malformed');
    });

    it('refuses a feature table without the version column, and a non-numeric row version', () => {
      const a = wireOf();
      const at = a.features.columns.indexOf('version');
      a.features.columns.splice(at, 1);
      for (const r of a.features.rows) r.splice(at, 1);
      refused(a, 'missing_column');
      const b = wireOf();
      const bt = b.features.columns.indexOf('version');
      for (const r of b.features.rows) r[bt] = '1';
      refused(b, 'malformed');
    });
  });

  it('rejects malformed payloads and unknown kinds', () => {
    expect(() => decodePage(null)).toThrowError(expect.objectContaining({ code: 'malformed' }));
    const wire = { ...encodePage(emptyPage), header: { ...emptyPage.header, kind: 'bogus' } };
    expect(() => decodePage(wire)).toThrowError(expect.objectContaining({ code: 'malformed' }));
  });
});

describe('observation history cap', () => {
  const obs = (n: number, property = 'p'): SyncPage['observations'] =>
    Array.from({ length: n }, (_, i) => ({
      featureId: 'f1' as FeatureId,
      property,
      result: i,
      phenomenonTime: null,
      resultTime: null,
      seq: i + 1,
      runId: `r${i}` as RunId,
    }));
  const withObs = (observations: SyncPage['observations']): SyncPage => ({ ...emptyPage, observations });

  it('accepts exactly SYNC_OBSERVATION_HISTORY per feature and property, both directions', () => {
    const page = withObs([...obs(SYNC_OBSERVATION_HISTORY), ...obs(SYNC_OBSERVATION_HISTORY, 'q')]);
    expect(decodePage(encodePage(page))).toEqual(page);
  });

  it('rejects one more on encode and on decode with a typed error', () => {
    const page = withObs(obs(SYNC_OBSERVATION_HISTORY + 1));
    expect(() => encodePage(page)).toThrowError(expect.objectContaining({ code: 'history_exceeded' }));
    const wire = encodePage(withObs(obs(SYNC_OBSERVATION_HISTORY)));
    const extra = [...wire.observations.rows, wire.observations.rows[0] as readonly unknown[]];
    expect(() => decodePage({ ...wire, observations: { ...wire.observations, rows: extra } })).toThrowError(
      expect.objectContaining({ code: 'history_exceeded' }),
    );
  });
});

describe('request', () => {
  it('round-trips and rejects other versions', () => {
    const req = { since: 12, scope: 'abc', v: SYNC_PROTOCOL_VERSION };
    expect(decodeRequest(encodeRequest(req))).toEqual(req);
    const resume = { since: 0, scope: 'abc', v: SYNC_PROTOCOL_VERSION, after: 40, pin: 99 };
    expect(decodeRequest(encodeRequest(resume))).toEqual(resume);
    expect(encodeRequest(req)).not.toHaveProperty('after');
    expect(encodeRequest(req)).not.toHaveProperty('limit');
    const capped = { ...req, limit: 500 };
    expect(decodeRequest(encodeRequest(capped))).toEqual(capped);
    expect(() => decodeRequest({ since: '0', v: '1', limit: '0' })).toThrowError(SyncProtocolError);
    expect(() => decodeRequest({ since: '0', v: '1', limit: 'x' })).toThrowError(SyncProtocolError);
    expect(() => decodeRequest({ since: '0', v: '1', after: 'x' })).toThrowError(SyncProtocolError);
    expect(() => decodeRequest({ since: '0', v: '99' })).toThrowError(
      expect.objectContaining({ code: 'version_mismatch' }),
    );
    expect(() => decodeRequest({ since: '-1', v: String(SYNC_PROTOCOL_VERSION) })).toThrowError(
      SyncProtocolError,
    );
  });
});

describe('tombstone kinds', () => {
  it('round-trips redaction and blob tombstones', () => {
    const page: SyncPage = {
      ...emptyPage,
      tombstones: [
        { seq: 3, kind: 'redaction', id: 'feature-1' },
        { seq: 4, kind: 'blob', id: 'ab'.repeat(32) },
      ],
    };
    expect(decodePage(encodePage(page))).toEqual(page);
  });
});

describe('header head', () => {
  it('a page without head is malformed', () => {
    const wire = encodePage(emptyPage);
    const header = { ...wire.header } as Record<string, unknown>;
    delete header.head;
    expect(() => decodePage({ ...wire, header })).toThrowError(
      expect.objectContaining({ code: 'malformed' }),
    );
  });
});

describe('scopeFingerprint', () => {
  const inputs = fc.array(fc.string(), { maxLength: 8 });
  it('is order independent', () => {
    fc.assert(
      fc.property(inputs, fc.array(fc.nat(), { maxLength: 8 }), (xs, keys) => {
        const key = (i: number): number => keys[i] ?? i;
        const shuffled = xs.map((x, i) => ({ x, k: key(i) })).sort((a, b) => a.k - b.k);
        expect(scopeFingerprint(shuffled.map((e) => e.x))).toBe(scopeFingerprint(xs));
      }),
    );
  });
  it('changes when any input changes', () => {
    fc.assert(
      fc.property(
        inputs.filter((x) => x.length > 0),
        fc.nat(),
        fc.string({ minLength: 1 }),
        (xs, i, suffix) => {
          const changed = [...xs];
          const at = i % xs.length;
          changed[at] = `${xs[at]}${suffix}`;
          expect(scopeFingerprint(changed)).not.toBe(scopeFingerprint(xs));
          expect(scopeFingerprint([...xs, 'extra'])).not.toBe(scopeFingerprint(xs));
        },
      ),
    );
  });
  it('separates input boundaries', () => {
    expect(scopeFingerprint(['ab', 'c'])).not.toBe(scopeFingerprint(['a', 'bc']));
  });
});
