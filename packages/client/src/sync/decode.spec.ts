import { describe, expect, it } from 'vitest';
import { SyncProtocolError, SYNC_PROTOCOL_VERSION, encodePage } from '@ueberblick/core/sync';
import type { SyncPage } from '@ueberblick/core/sync';
import { openDeviceStore } from '../store/open';
import { fakeEnv, feature, memoryMarker } from '../store/test-env';
import {
  SYNC_PAGE_MAX_ROWS,
  createWorkerDecoder,
  decodingTransport,
  inlineDecoder,
  serveDecoder,
} from './decode';
import type { EncodedSyncTransport, MessagePortLike, PagePayload } from './decode';
import { createSyncWorker } from './worker';
import { FakeServer, memoryMeta } from './test-server';

function page(n: number, more = false): SyncPage {
  const features = Array.from({ length: n }, (_, i) => feature(i + 1, i + 1));
  return {
    header: {
      kind: 'snapshot',
      cursor: n,
      head: n,
      more,
      scopeFingerprint: 's',
      versions: { deployed: 1, live: [1] },
    },
    features: features.map((f) => ({ ...f, version: 1 })),
    edges: [],
    observations: [],
    tombstones: [],
    runs: [],
    people: [],
  };
}

/** A decoder whose worker end is really behind a MessageChannel: payloads and pages cross a structured clone. */
function channelDecoder() {
  const { port1, port2 } = new MessageChannel();
  serveDecoder(port2 as never);
  const decoder = createWorkerDecoder(port1 as never);
  return { decoder, close: () => (port1.close(), port2.close()) };
}

describe('page decode in a worker', () => {
  it('decodes tuple pages and raw JSON text across a message channel, identical to inline', async () => {
    const { decoder, close } = channelDecoder();
    const p = page(50);
    const encoded = encodePage(p);
    expect(await decoder.decode(encoded, 100)).toEqual(p);
    expect(await decoder.decode(JSON.stringify(encoded), 100)).toEqual(p);
    expect(await inlineDecoder.decode(encoded, 100)).toEqual(p);
    close();
  });

  it('matches concurrent requests to their replies', async () => {
    const { decoder, close } = channelDecoder();
    const [a, b] = await Promise.all([
      decoder.decode(encodePage(page(3)), 10),
      decoder.decode(encodePage(page(7)), 10),
    ]);
    expect([a.features.length, b.features.length]).toEqual([3, 7]);
    close();
  });

  it('typed errors cross the boundary as SyncProtocolError', async () => {
    const { decoder, close } = channelDecoder();
    await expect(decoder.decode('{not json', 10)).rejects.toMatchObject({ code: 'malformed' });
    const bad = { ...encodePage(page(1)), v: SYNC_PROTOCOL_VERSION + 1 };
    const err = await decoder.decode(bad, 10).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SyncProtocolError);
    close();
  });

  it('the page cap rejects a page with more feature rows than requested', async () => {
    const { decoder, close } = channelDecoder();
    await expect(decoder.decode(encodePage(page(11)), 10)).rejects.toMatchObject({ code: 'malformed' });
    await expect(decoder.decode(encodePage(page(10)), 10)).resolves.toBeDefined();
    close();
  });

  it('decodingTransport requests the cap and drives a full pull through the worker decoder', async () => {
    const server = new FakeServer();
    server.pageSize = 3;
    for (let n = 1; n <= 8; n++) server.write(n);
    const asked: number[] = [];
    const encoded: EncodedSyncTransport = {
      fetchEncoded: async (req): Promise<PagePayload> => {
        asked.push(req.limit ?? -1);
        return JSON.stringify(encodePage(await server.fetchPage(req)));
      },
    };
    const { decoder, close } = channelDecoder();
    const store = await openDeviceStore('d', { env: fakeEnv(), marker: memoryMarker() });
    const worker = createSyncWorker({
      store,
      transport: decodingTransport(encoded, decoder),
      meta: memoryMeta(),
      predictions: { rederive: () => Promise.resolve() },
      clock: { now: () => '2026-09-29T00:00:00Z' as never },
    });
    const r = await worker.pull();
    expect(r.pages).toBe(3);
    expect(store.featureIdsOfType('tree')).toHaveLength(8);
    expect(new Set(asked)).toEqual(new Set([SYNC_PAGE_MAX_ROWS]));
    close();
  });

  describe('faults across the boundary', () => {
    /** Two ports wired in-process without structured clone, so a test can shape the worker's reply. */
    function wire() {
      const a: MessagePortLike = { postMessage: (m) => b.onmessage?.({ data: m }), onmessage: null };
      const b: MessagePortLike = { postMessage: (m) => a.onmessage?.({ data: m }), onmessage: null };
      return { a, b };
    }

    it('a non-typed throw in the worker rejects with a plain Error, not a protocol error', async () => {
      const { a, b } = wire();
      serveDecoder(b);
      const decoder = createWorkerDecoder(a);
      const payload = {
        get v(): number {
          throw new RangeError('boom');
        },
      } as unknown as PagePayload;
      const err = await decoder.decode(payload, 10).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(SyncProtocolError);
      expect((err as Error).message).toContain('boom');
    });

    it('an unknown error code from the worker is a fault, never relabelled malformed', async () => {
      const { a, b } = wire();
      b.onmessage = (ev) => b.postMessage({ id: (ev.data as { id: number }).id, code: 'nope', message: 'x' });
      const err = await createWorkerDecoder(a)
        .decode('{}', 10)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(SyncProtocolError);
      expect((err as Error).message).toContain('nope');
    });
  });
});
