import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { THUMB_SIZES } from '@ueberblick/core';
import { createThumbnails, ThumbnailFailed } from './thumbs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const dir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'ub-thumbs-'));
  dirs.push(d);
  return d;
};
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
async function* once(b: Buffer) {
  yield b;
}
async function read(r: { stream: AsyncIterable<Uint8Array> } | undefined): Promise<Buffer> {
  if (r === undefined) throw new Error('no thumbnail');
  const parts: Buffer[] = [];
  for await (const c of r.stream) parts.push(Buffer.from(c));
  return Buffer.concat(parts);
}
const base = { create: { width: 1600, height: 1000, channels: 3 as const, background: '#468' } };

describe('thumbnails', () => {
  it('makes JPEG and PNG thumbnails at every size and serves the second request from the cache file', async () => {
    const root = dir();
    const t = createThumbnails(join(root, 'thumbs'));
    const jpeg = await sharp(base).jpeg().toBuffer();
    const png = await sharp(base).png().toBuffer();
    for (const [src, mime] of [
      [jpeg, 'image/jpeg'],
      [png, 'image/png'],
    ] as const)
      for (const size of THUMB_SIZES.keys) {
        let reads = 0;
        const source = () => {
          reads++;
          return once(src);
        };
        const first = await t.get(sha(src), size, mime, source);
        const firstBytes = await read(first);
        const meta = await sharp(firstBytes).metadata();
        expect(meta.format).toBe('webp');
        expect([meta.width, meta.height]).toEqual(size === 'list' ? [80, 80] : [800, 500]);
        const file = join(root, 'thumbs', `${sha(src)}.${size}.webp`);
        const mtime = statSync(file).mtimeMs;
        const second = await t.get(sha(src), size, mime, source);
        expect(await read(second)).toEqual(firstBytes);
        expect(reads).toBe(1); // the original was read once
        expect(statSync(file).mtimeMs).toBe(mtime);
      }
  });

  it('applies EXIF orientation and strips GPS and all other metadata', async () => {
    const t = createThumbnails(dir());
    const src = await sharp(base)
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 30/1 0/1' } } })
      .toBuffer();
    expect((await sharp(src).metadata()).orientation).toBe(6);
    expect((await sharp(src).metadata()).exif).toBeDefined();
    const out = await read(await t.get(sha(src), 'preview', 'image/jpeg', () => once(src)));
    const meta = await sharp(out).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    // 1600x1000 with orientation 6 is portrait once upright: the height is the longer side
    expect(meta.height ?? 0).toBeGreaterThan(meta.width ?? 0);
  });

  it('has nothing to make from a non-image; says so (not a 404) for an image that does not decode; leaves no file behind', async () => {
    const root = dir();
    const t = createThumbnails(root);
    const text = Buffer.from('hello');
    expect(await t.get(sha(text), 'list', 'text/plain', () => once(text))).toBeUndefined();
    await expect(t.get(sha(text), 'preview', 'image/jpeg', () => once(text))).rejects.toMatchObject({
      name: 'ThumbnailFailed',
      code: 'decode_failed',
    });
    await expect(t.get(sha(text), 'list', 'image/jpeg', () => once(text))).rejects.toBeInstanceOf(
      ThumbnailFailed,
    );
    expect(existsSync(root) ? readdirSync(root) : []).toEqual([]);
  });

  it('reports a folder it cannot write as write_failed', async () => {
    const root = dir();
    const png = await sharp(base).png().toBuffer();
    // the thumbs folder cannot be created below a regular file
    const t = createThumbnails(join(root, 'thumbs'));
    const blocked = createThumbnails(join(root, 'file', 'thumbs'));
    writeFileSync(join(root, 'file'), 'x');
    await expect(blocked.get(sha(png), 'list', 'image/png', () => once(png))).rejects.toMatchObject({
      code: 'write_failed',
    });
    expect((await read(await t.get(sha(png), 'list', 'image/png', () => once(png)))).length).toBeGreaterThan(
      0,
    );
  });
});
