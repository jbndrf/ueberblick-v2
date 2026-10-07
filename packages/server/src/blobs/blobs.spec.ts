import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openProjectDb } from '../db/open';
import { BlobHashMismatch, createBlobs, fileBlobStore } from './index';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'ub-blob-'));
  dirs.push(root);
  const db = openProjectDb(':memory:', 'p');
  const store = fileBlobStore(root);
  return { root, db, blobs: createBlobs({ db, store, clock: { now: () => '2026-01-01T00:00:00.000Z' } }) };
};
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
async function* chunks(...parts: Buffer[]): AsyncGenerator<Uint8Array> {
  for (const p of parts) yield p;
}
const collect = async (s: AsyncIterable<Uint8Array>): Promise<Buffer> => {
  const out: Buffer[] = [];
  for await (const c of s) out.push(Buffer.from(c));
  return Buffer.concat(out);
};
const files = (root: string): string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);

describe('blobs', () => {
  it('stores the same bytes twice as one blob', async () => {
    const { db, blobs, root } = setup();
    const data = Buffer.from('hello world');
    const a = await blobs.put(chunks(data.subarray(0, 5), data.subarray(5)), 'text/plain');
    const b = await blobs.put(chunks(data), 'text/plain');
    expect(a).toEqual({ sha256: sha(data), bytes: 11 });
    expect(b).toEqual(a);
    expect(db.prepare('SELECT count(*) AS n FROM blobs').get()).toEqual({ n: 1 });
    expect(files(root)).toEqual([a.sha256]);
  });

  it('round-trips through get and reports has', async () => {
    const { blobs } = setup();
    const data = Buffer.from('bytes');
    const { sha256 } = await blobs.put(chunks(data), 'application/octet-stream');
    expect(blobs.has(sha256)).toBe(true);
    const got = blobs.get(sha256);
    expect(got?.mime).toBe('application/octet-stream');
    expect(got && (await collect(got.stream))).toEqual(data);
    expect(blobs.has('0'.repeat(64))).toBe(false);
    expect(blobs.get('0'.repeat(64))).toBeUndefined();
  });

  it('rejects a hash mismatch and stores nothing', async () => {
    const { db, blobs, root } = setup();
    await expect(
      blobs.put(chunks(Buffer.from('abc')), 'text/plain', sha(Buffer.from('other'))),
    ).rejects.toBeInstanceOf(BlobHashMismatch);
    expect(db.prepare('SELECT count(*) AS n FROM blobs').get()).toEqual({ n: 0 });
    expect(files(root)).toEqual([]);
  });

  it('accepts a matching declared hash', async () => {
    const { blobs } = setup();
    const data = Buffer.from('abc');
    await expect(blobs.put(chunks(data), 'text/plain', sha(data))).resolves.toEqual({
      sha256: sha(data),
      bytes: 3,
    });
  });

  it('rejects malformed hashes (no path traversal)', () => {
    const { blobs } = setup();
    expect(() => blobs.get('../../etc/passwd')).toThrow();
  });

  it('streams a 200 MB upload without buffering it', async () => {
    const { blobs } = setup();
    const chunk = Buffer.alloc(1024 * 1024, 7);
    async function* big(): AsyncGenerator<Uint8Array> {
      for (let i = 0; i < 200; i++) yield chunk;
    }
    const before = process.memoryUsage().rss;
    let peak = before;
    const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 20);
    const r = await blobs.put(big(), 'application/octet-stream');
    clearInterval(timer);
    peak = Math.max(peak, process.memoryUsage().rss);
    expect(r.bytes).toBe(200 * 1024 * 1024);
    expect(peak - before).toBeLessThan(80 * 1024 * 1024);
  }, 60_000);
});
