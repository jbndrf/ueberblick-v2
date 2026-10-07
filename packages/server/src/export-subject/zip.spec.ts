import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createZip, ZipLimitError, ZipNameError, type ZipLimits } from './zip';
import { collectBytes, readZip } from './zip-reader.testkit';

const NOW = '2026-09-30T10:00:00.000Z';
async function* one(...parts: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const p of parts) yield p;
}
async function build(entries: [string, Uint8Array[]][], limits?: ZipLimits): Promise<Uint8Array> {
  const zip = createZip(NOW, limits);
  async function* all(): AsyncGenerator<Uint8Array> {
    for (const [n, parts] of entries) yield* zip.add(n, one(...parts));
    yield* zip.finish();
  }
  return collectBytes(all());
}

describe('zip writer', () => {
  it('round-trips entries streamed in chunks, including an empty one', async () => {
    const enc = new TextEncoder();
    const zip = await build([
      ['a.txt', [enc.encode('hel'), enc.encode('lo')]],
      ['dir/empty', []],
      ['ü.txt', [enc.encode('umlaut')]],
    ]);
    const got = readZip(zip);
    expect(new TextDecoder().decode(got.get('a.txt'))).toBe('hello');
    expect(got.get('dir/empty')?.length).toBe(0);
    expect(new TextDecoder().decode(got.get('ü.txt'))).toBe('umlaut');
  });

  it('round-trips arbitrary bytes and chunkings (property)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.uint8Array({ maxLength: 50 }), { maxLength: 6 }), async (chunks) => {
        const got = readZip(await build([['x', chunks]]));
        expect([...(got.get('x') ?? [])]).toEqual(chunks.flatMap((c) => [...c]));
      }),
    );
  });

  it('refuses a duplicate or unsafe entry name with its own error, not a limit error', async () => {
    const zip = createZip(NOW);
    await collectBytes(zip.add('a', one()));
    for (const bad of ['a', '../x', '/abs', 'a/../b']) {
      const err = await collectBytes(zip.add(bad, one())).catch((e: unknown) => e);
      expect(err, bad).toBeInstanceOf(ZipNameError);
      expect(err, bad).not.toBeInstanceOf(ZipLimitError);
    }
  });

  it('refuses more entries than the format holds (65,535), and a lowered limit trips the same way', async () => {
    const zip = createZip(NOW, { maxEntries: 3 });
    for (const n of ['a', 'b', 'c']) await collectBytes(zip.add(n, one()));
    await expect(collectBytes(zip.add('d', one()))).rejects.toThrow(/entries/);
    await expect(collectBytes(zip.add('d', one()))).rejects.toBeInstanceOf(ZipLimitError);
    // the real limit, without allocating 65,536 archives worth of bytes: empty entries are small
    const full = createZip(NOW);
    for (let i = 0; i < 0xffff; i++) await collectBytes(full.add(`e${i}`, one()));
    await expect(collectBytes(full.add('one-too-many', one()))).rejects.toBeInstanceOf(ZipLimitError);
  });

  it('refuses an archive over the size limit, while writing an entry and in the directory', async () => {
    const big = new Uint8Array(100);
    await expect(build([['a', [big]]], { maxBytes: 100 })).rejects.toBeInstanceOf(ZipLimitError);
    await expect(build([['a', [big, big]]], { maxBytes: 10_000 })).resolves.toBeInstanceOf(Uint8Array);
    // the entry fits but the central directory does not
    const fits = 30 + 1 + 100 + 16;
    await expect(build([['a', [big]]], { maxBytes: fits })).rejects.toBeInstanceOf(ZipLimitError);
  });
});
