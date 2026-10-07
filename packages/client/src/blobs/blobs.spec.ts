import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fakeEnv } from '../store/test-env';
import { THUMB_FETCH_CONCURRENCY, type ThumbCache, type ThumbTransport } from './contract';
import { downloadThumbs } from './download';
import { idbThumbCache } from './idb';
import { memoryThumbCache } from './memory';

const sha = (n: number): string => n.toString(16).padStart(64, '0');
const bytesOf = (n: number): Uint8Array => new Uint8Array(n).fill(7);

const caches: [string, () => ThumbCache][] = [
  ['memory', () => memoryThumbCache()],
  ['idb', () => idbThumbCache(fakeEnv(), 'thumbs-test')],
];

describe.each(caches)('ThumbCache (%s)', (_name, make) => {
  it('keeps what is put, counts it and gives the bytes back', async () => {
    const c = make();
    await c.put(sha(1), bytesOf(10), 'image/webp');
    await c.put(sha(2), bytesOf(5), 'image/webp');
    await c.put(sha(1), bytesOf(10), 'image/webp'); // the same photo twice is one row
    expect(await c.count()).toBe(2);
    expect(await c.bytes()).toBe(15);
    expect((await c.keys()).slice().sort()).toEqual([sha(1), sha(2)]);
    expect(await c.has(sha(1))).toBe(true);
    expect(await c.has(sha(3))).toBe(false);
    const blob = await c.get(sha(2));
    expect(blob?.size).toBe(5);
    expect(blob?.type).toBe('image/webp');
    expect(await c.get(sha(3))).toBeUndefined();
  });

  it('remove drops one, clear drops all', async () => {
    const c = make();
    await c.put(sha(1), bytesOf(1), 'image/webp');
    await c.put(sha(2), bytesOf(1), 'image/webp');
    await c.remove(sha(1));
    expect(await c.count()).toBe(1);
    await c.clear();
    expect(await c.count()).toBe(0);
    expect(await c.bytes()).toBe(0);
  });
});

it('a missing IndexedDB makes an unsupported cache that stores nothing', async () => {
  const c = idbThumbCache(undefined, 'x');
  expect(c.supported).toBe(false);
  await c.put(sha(1), bytesOf(1), 'image/webp');
  expect(await c.count()).toBe(0);
  expect(await c.get(sha(1))).toBeUndefined();
});

function transport(missing: ReadonlySet<string> = new Set(), failing: ReadonlySet<string> = new Set()) {
  let inFlight = 0;
  const t = {
    peak: 0,
    asked: [] as string[],
    fetch: async (s: string) => {
      t.asked.push(s);
      inFlight += 1;
      t.peak = Math.max(t.peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      if (failing.has(s)) throw new Error('offline');
      return missing.has(s) ? undefined : { bytes: bytesOf(100), mime: 'image/webp' };
    },
  } satisfies ThumbTransport & { peak: number; asked: string[] };
  return t;
}

describe('downloadThumbs', () => {
  it('stores a thumbnail of every photo and reports progress up to the total', async () => {
    const cache = memoryThumbCache();
    const t = transport();
    const seen: number[] = [];
    const out = await downloadThumbs({
      shas: [sha(1), sha(2), sha(3)],
      cache,
      transport: t,
      onProgress: (p) => seen.push(p.done),
    });
    expect(await cache.count()).toBe(3);
    expect(out).toEqual({ stored: 3, failed: 0, stopped: undefined });
    expect(seen.at(-1)).toBe(3);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it('skips what is on the device and asks the server only for the rest', async () => {
    const cache = memoryThumbCache();
    await cache.put(sha(1), bytesOf(1), 'image/webp');
    const t = transport();
    await downloadThumbs({ shas: [sha(1), sha(2), sha(2)], cache, transport: t });
    expect(t.asked).toEqual([sha(2)]);
  });

  it('one that fails (no thumbnail, or the connection broke) does not stop the others', async () => {
    const cache = memoryThumbCache();
    const out = await downloadThumbs({
      shas: [sha(1), sha(2), sha(3)],
      cache,
      transport: transport(new Set([sha(1)]), new Set([sha(2)])),
    });
    expect(await cache.keys()).toEqual([sha(3)]);
    expect(out.failed).toBe(2);
  });

  it('fetches at most THUMB_FETCH_CONCURRENCY at once', async () => {
    const t = transport();
    await downloadThumbs({
      shas: Array.from({ length: 20 }, (_, i) => sha(i)),
      cache: memoryThumbCache(),
      transport: t,
    });
    expect(t.peak).toBeLessThanOrEqual(THUMB_FETCH_CONCURRENCY);
    expect(t.peak).toBeGreaterThan(1);
  });

  it('stops at the byte cap and says so', async () => {
    const cache = memoryThumbCache();
    const out = await downloadThumbs({
      shas: Array.from({ length: 10 }, (_, i) => sha(i)),
      cache,
      transport: transport(),
      maxBytes: 250,
      concurrency: 1,
    });
    expect(out.stopped).toBe('full');
    expect(await cache.bytes()).toBeLessThanOrEqual(300);
    expect(await cache.count()).toBeLessThan(10);
  });

  it('an aborted download stops asking', async () => {
    const ctl = new AbortController();
    const t = transport();
    const cache = memoryThumbCache();
    const run = downloadThumbs({
      shas: Array.from({ length: 50 }, (_, i) => sha(i)),
      cache,
      transport: t,
      signal: ctl.signal,
      concurrency: 1,
    });
    setTimeout(() => ctl.abort(), 5);
    const out = await run;
    expect(out.stopped).toBe('aborted');
    expect(t.asked.length).toBeLessThan(50);
  });

  it('property: afterwards the cache holds exactly the distinct photos the server had a thumbnail for', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 30 }), { maxLength: 40 }),
        fc.array(fc.integer({ min: 0, max: 30 }), { maxLength: 10 }),
        async (ids, gone) => {
          const cache = memoryThumbCache();
          const none = new Set(gone.map(sha));
          await downloadThumbs({ shas: ids.map(sha), cache, transport: transport(none) });
          const want = new Set(ids.map(sha).filter((s) => !none.has(s)));
          expect(new Set(await cache.keys())).toEqual(want);
          expect(await cache.count()).toBe(want.size);
        },
      ),
      { numRuns: 25 },
    );
  });
});
