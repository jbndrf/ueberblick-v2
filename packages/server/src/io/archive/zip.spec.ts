import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ARCHIVE_ZIP_LIMITS } from './manifest';
import { openZip, zipStream, ZipCorrupt, type ZipEntry } from './zip';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'zip-spec-'));
  dirs.push(d);
  return d;
};
async function toFile(entries: ZipEntry[]): Promise<string> {
  const parts: Buffer[] = [];
  for await (const c of zipStream(entries)) parts.push(Buffer.from(c));
  const path = join(tmp(), 'a.zip');
  writeFileSync(path, Buffer.concat(parts));
  return path;
}
async function* chunks(...parts: string[]): AsyncGenerator<Uint8Array> {
  for (const p of parts) yield Buffer.from(p);
}
async function bytes(it: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const out: Buffer[] = [];
  for await (const c of it) out.push(Buffer.from(c));
  return Buffer.concat(out);
}

describe('zip', () => {
  it('round-trips deflated and stored entries, empty ones and umlauts in names', async () => {
    const path = await toFile([
      { name: 'a.txt', data: chunks('hello ', 'world') },
      { name: 'blobs/ä.bin', data: chunks('xyz'), method: 'store' },
      { name: 'empty', data: chunks() },
    ]);
    const zip = await openZip(path, ARCHIVE_ZIP_LIMITS);
    expect(zip.entries.map((e) => e.name)).toEqual(['a.txt', 'blobs/ä.bin', 'empty']);
    expect(await zip.text('a.txt')).toBe('hello world');
    expect(await zip.text('blobs/ä.bin')).toBe('xyz');
    expect(await zip.text('empty')).toBe('');
  });

  it('is readable by the system unzip (when installed)', async () => {
    const path = await toFile([{ name: 'a.txt', data: chunks('x'.repeat(100000)) }]);
    try {
      expect(execFileSync('unzip', ['-t', path]).toString()).toContain('No errors');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  });

  it('property: any bytes in any chunking come back identical', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.uint8Array({ maxLength: 3000 }), { maxLength: 4 }),
        fc.boolean(),
        async (parts, store) => {
          const path = await toFile([
            {
              name: 'f',
              method: store ? 'store' : 'deflate',
              data: (async function* () {
                for (const p of parts) yield p;
              })(),
            },
          ]);
          const got = await bytes((await openZip(path, ARCHIVE_ZIP_LIMITS)).open('f'));
          expect(got.equals(Buffer.concat(parts))).toBe(true);
        },
      ),
      { numRuns: 25 },
    );
  });

  it('refuses a file that is no ZIP and detects a flipped byte', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'x'), 'not a zip');
    await expect(openZip(join(dir, 'x'), ARCHIVE_ZIP_LIMITS)).rejects.toBeInstanceOf(ZipCorrupt);
    const path = await toFile([{ name: 'a', data: chunks('abcdefghij'), method: 'store' }]);
    const raw = readFileSync(path);
    const at = raw.indexOf('abcdefghij') + 2;
    raw[at] = (raw[at] ?? 0) ^ 0xff;
    writeFileSync(path, raw);
    await expect(bytes((await openZip(path, ARCHIVE_ZIP_LIMITS)).open('a'))).rejects.toBeInstanceOf(
      ZipCorrupt,
    );
  });
});
