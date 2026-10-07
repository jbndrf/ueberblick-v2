import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SyncProtocolError } from '@ueberblick/core/sync';
import { DeviceStoreError } from '../store/codes';
import type { StoredCursor } from '../store/contract';
import { fid } from '../store/test-env';
import {
  FROM_WORKER_KINDS,
  HOST_PROTOCOL_VERSION,
  HostProtocolError,
  TO_WORKER_KINDS,
  fromWire,
  parseFromWorker,
  parseToWorker,
  toWire,
  type FromWorker,
  type ToWorker,
} from './protocol';

const v = HOST_PROTOCOL_VERSION;
const cursor: StoredCursor = { kind: 'delta', cursor: 7, scopeFingerprint: 's' };
const plan = {
  featurePuts: [],
  featureDeletes: [],
  edgePuts: [],
  edgeDeletes: [],
  historyPuts: [],
  runPuts: [],
  peoplePuts: [],
};
const status = {
  phase: 'snapshot',
  lastSyncedAt: undefined,
  lastSyncedSeq: undefined,
  lastError: undefined,
  featuresLoaded: 3,
} as const;

const toWorker: readonly ToWorker[] = [
  { v, kind: 'init', name: 'p1', config: { baseUrl: '/x' } },
  { v, kind: 'start' },
  { v, kind: 'pull', id: 1 },
  { v, kind: 'rederived', id: 2 },
  { v, kind: 'rederived', id: 3, error: { kind: 'store', code: 'aborted', message: 'no' } },
  { v, kind: 'close' },
];
const fromWorker: readonly FromWorker[] = [
  { v, kind: 'ready', cursor: undefined },
  { v, kind: 'ready', cursor },
  { v, kind: 'pulled', id: 1, result: { pages: 2, reset: undefined, cursor: 7 } },
  { v, kind: 'pulled', id: 2, error: { kind: 'protocol', code: 'version_mismatch', message: 'x' } },
  { v, kind: 'status', status },
  { v, kind: 'versions', versions: { deployed: 2, live: [1, 2] }, completed: false },
  { v, kind: 'versions', versions: { deployed: 2, live: [1, 2] }, completed: true },
  { v, kind: 'change', notice: { from: undefined, commit: { kind: 'page', plan, cursor } } },
  { v, kind: 'change', notice: { from: cursor, commit: { kind: 'cleared' } } },
  {
    v,
    kind: 'change',
    notice: { from: cursor, part: { index: 1, count: 3 }, commit: { kind: 'page', plan, cursor } },
  },
  {
    v,
    kind: 'change',
    notice: { from: cursor, commit: { kind: 'history_dropped', featureId: fid(1), properties: ['a'] } },
  },
  { v, kind: 'change', notice: { from: cursor, commit: { kind: 'blob_purge', ids: ['ab', 'cd'] } } },
  { v, kind: 'rederive', id: 4, reason: 'scope_changed' },
  { v, kind: 'issue', issue: { code: 'blocked', message: 'm' } },
  { v, kind: 'fault', message: 'boom' },
];

/** What a real port does to a message. */
const clone = <T>(m: T): T => structuredClone(m);

async function throughChannel<T>(m: T): Promise<T> {
  const { port1, port2 } = new MessageChannel();
  const got = new Promise<T>((resolve) => {
    port2.onmessage = (e) => resolve(e.data as T);
  });
  port1.postMessage(m);
  const out = await got;
  port1.close();
  port2.close();
  return out;
}

describe('host protocol round trip', () => {
  it('every message kind is covered by the fixtures', () => {
    expect(new Set(toWorker.map((m) => m.kind))).toEqual(new Set(TO_WORKER_KINDS));
    expect(new Set(fromWorker.map((m) => m.kind))).toEqual(new Set(FROM_WORKER_KINDS));
  });

  it('every message survives structured clone and a real MessageChannel unchanged', async () => {
    for (const m of toWorker) expect(parseToWorker(await throughChannel(m))).toEqual(m);
    for (const m of fromWorker) expect(parseFromWorker(await throughChannel(m))).toEqual(m);
  });

  it('property: pull, rederive and cursor-carrying messages round-trip for any values', () => {
    const cursorArb = fc.record({
      kind: fc.constantFrom('snapshot', 'delta'),
      cursor: fc.integer({ min: 0, max: 2 ** 40 }),
      scopeFingerprint: fc.string(),
    });
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e6 }), fc.option(cursorArb, { nil: undefined }), (id, c) => {
        const pull: ToWorker = { v, kind: 'pull', id };
        const ready: FromWorker = { v, kind: 'ready', cursor: c };
        const change: FromWorker = { v, kind: 'change', notice: { from: c, commit: { kind: 'cleared' } } };
        expect(parseToWorker(clone(pull))).toEqual(pull);
        expect(parseFromWorker(clone(ready))).toEqual(ready);
        expect(parseFromWorker(clone(change))).toEqual(change);
      }),
    );
  });
});

describe('host protocol refuses loudly', () => {
  const refuse = (parse: () => unknown, code: string) =>
    expect(parse).toThrow(expect.objectContaining({ name: 'HostProtocolError', code }));

  it('a message of another version', () => {
    refuse(() => parseToWorker({ v: v + 1, kind: 'start' }), 'bad_version');
    refuse(() => parseFromWorker({ kind: 'fault', message: 'x' }), 'bad_version');
  });

  it('an unknown kind, in both directions and inside a change', () => {
    refuse(() => parseToWorker({ v, kind: 'reboot' }), 'unknown_kind');
    refuse(() => parseToWorker({ v, kind: 'ready', cursor: undefined }), 'unknown_kind'); // the other direction's kind
    refuse(() => parseFromWorker({ v, kind: 'pull', id: 1 }), 'unknown_kind');
    refuse(
      () => parseFromWorker({ v, kind: 'change', notice: { from: undefined, commit: { kind: 'explode' } } }),
      'unknown_kind',
    );
  });

  it('ill-typed fields and non-objects', () => {
    const sliced = (part: unknown) => ({
      v,
      kind: 'change',
      notice: { from: undefined, part, commit: { kind: 'cleared' } },
    });
    refuse(() => parseFromWorker(sliced({ index: 3, count: 3 })), 'ill_typed');
    refuse(() => parseFromWorker(sliced({ index: 'a', count: 3 })), 'ill_typed');
    refuse(() => parseToWorker(null), 'ill_typed');
    refuse(() => parseToWorker('start'), 'ill_typed');
    refuse(() => parseToWorker({ v, kind: 'pull', id: '1' }), 'ill_typed');
    refuse(() => parseToWorker({ v, kind: 'init', name: 'p', config: { a: 1 } }), 'ill_typed');
    refuse(
      () => parseFromWorker({ v, kind: 'ready', cursor: { kind: 'snapshot', cursor: 'x' } }),
      'ill_typed',
    );
    refuse(() => parseFromWorker({ v, kind: 'pulled', id: 1 }), 'ill_typed');
    refuse(
      () => parseFromWorker({ v, kind: 'status', status: { ...status, phase: 'napping' } }),
      'ill_typed',
    );
    refuse(() => parseFromWorker({ v, kind: 'rederive', id: 1, reason: 'because' }), 'ill_typed');
    refuse(() => parseFromWorker({ v, kind: 'issue', issue: { code: 'nope', message: 'm' } }), 'ill_typed');
    refuse(
      () =>
        parseFromWorker({
          v,
          kind: 'change',
          notice: { from: undefined, commit: { kind: 'page', plan: { ...plan, featurePuts: 3 }, cursor } },
        }),
      'ill_typed',
    );
  });
});

describe('errors on the wire', () => {
  it('typed errors are rebuilt as their class and code', () => {
    const p = fromWire(toWire(new SyncProtocolError('version_mismatch', 'v')));
    expect(p).toBeInstanceOf(SyncProtocolError);
    expect(p).toMatchObject({ code: 'version_mismatch', message: 'v' });
    const s = fromWire(toWire(new DeviceStoreError('quota_exceeded', 'full')));
    expect(s).toBeInstanceOf(DeviceStoreError);
    expect(s).toMatchObject({ code: 'quota_exceeded' });
    expect(fromWire(toWire(new Error('net')))).toMatchObject({ message: 'net' });
  });

  it('an unknown code is itself an error, never a plain Error', () => {
    const e = fromWire({ kind: 'protocol', code: 'made_up', message: 'x' });
    expect(e).toBeInstanceOf(HostProtocolError);
    expect(fromWire({ kind: 'store', code: undefined, message: 'x' })).toBeInstanceOf(HostProtocolError);
  });
});
