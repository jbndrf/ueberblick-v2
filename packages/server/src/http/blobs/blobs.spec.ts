import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { dirs, file, logLines, PHOTO, SECRET, sha, world } from './blobs.testkit';

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('upload', () => {
  it('stores bytes in the data folder; a repeat is 201 like the first; wrong hash 409; over limit 413; 401 without a session', async () => {
    const w = await world({ maxUploadBytes: 20 });
    const h = sha(PHOTO);
    const first = await w.call('put', h, { cookie: w.cookies.mia, body: PHOTO, type: 'image/jpeg' });
    expect(first.status).toBe(201);
    expect(existsSync(join(w.root, h.slice(0, 2), h.slice(2, 4), h))).toBe(true);
    expect((await w.call('put', h, { cookie: w.cookies.mia, body: PHOTO })).status).toBe(201);
    const wrong = await w.call('put', sha(SECRET), { cookie: w.cookies.mia, body: PHOTO });
    expect(wrong.status).toBe(409);
    expect(w.store.has(sha(SECRET))).toBe(false);
    const big = Buffer.alloc(64, 1);
    expect((await w.call('put', sha(big), { cookie: w.cookies.mia, body: big })).status).toBe(413);
    // no content-length declared: the stream itself is cut
    const chunked = new Request(`http://x/api/p/trees/blobs/${sha(big)}`, {
      method: 'PUT',
      headers: { cookie: w.cookies.mia },
      body: new ReadableStream({
        start(c) {
          c.enqueue(big.subarray(0, 32));
          c.enqueue(big.subarray(32));
          c.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    const r = await w.handlers.put(chunked, { params: { project: 'trees', sha: sha(big) } });
    expect(r.status).toBe(413);
    expect(w.store.has(sha(big))).toBe(false);
    expect((await w.call('put', h, { body: PHOTO })).status).toBe(401);
    expect((await w.call('put', h, { cookie: w.cookies.other, body: PHOTO })).status).toBe(403);
    expect((await w.call('head', h, { cookie: w.cookies.mia })).status).toBe(200);
    expect((await w.call('head', sha(SECRET), { cookie: w.cookies.mia })).status).toBe(404);
  });
});

describe('a branding icon (A-036)', () => {
  const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  it('is served to a participant sandboxed and never sniffed, for SVG in particular', async () => {
    const w = await world(undefined, sha(SVG));
    await w.call('put', sha(SVG), { cookie: w.cookies.admin, body: SVG, type: 'image/svg+xml' });
    const res = await w.call('get', sha(SVG), { cookie: w.cookies.bernd });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('download', () => {
  async function stored() {
    const w = await world();
    await w.call('put', sha(PHOTO), { cookie: w.cookies.mia, body: PHOTO, type: 'image/jpeg' });
    await w.call('put', sha(SECRET), { cookie: w.cookies.sabine, body: SECRET, type: 'image/jpeg' });
    const mia = w.actor('mia', 'melder');
    const sabine = w.actor('sabine', 'sachbearbeiter');
    expect(w.runAs(mia, 'melden', { kategorie: 'x', foto: [file(PHOTO)] }).outcome).toBe('accepted');
    expect(w.runAs(sabine, 'ablegen', { anhang: [file(SECRET)] }).outcome).toBe('accepted');
    return w;
  }

  it('who can read the property gets 200 with the headers; others get 404', async () => {
    const w = await stored();
    const res = await w.call('get', sha(PHOTO), { cookie: w.cookies.sabine });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    expect(res.headers.get('etag')).toBe(`"${sha(PHOTO)}"`);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PHOTO);
    // unreadable property (bernd saw the feature but not `foto`), other feature type, other project, anonymous
    expect((await w.call('get', sha(PHOTO), { cookie: w.cookies.bernd })).status).toBe(404);
    expect((await w.call('get', sha(SECRET), { cookie: w.cookies.bernd })).status).toBe(404);
    expect((await w.call('get', sha(PHOTO), { cookie: w.cookies.other, project: 'other' })).status).toBe(404);
    expect((await w.call('get', sha(PHOTO), { cookie: w.cookies.other })).status).toBe(403);
    expect((await w.call('get', sha(PHOTO))).status).toBe(401);
    expect((await w.call('get', sha(Buffer.from('nope')), { cookie: w.cookies.sabine })).status).toBe(404);
  });

  it('the author keeps access although the property is unreadable to them', async () => {
    const w = await stored();
    const own = await w.call('get', sha(PHOTO), { cookie: w.cookies.mia });
    expect(own.status).toBe(200);
    await own.arrayBuffer();
    expect((await w.call('get', sha(SECRET), { cookie: w.cookies.mia })).status).toBe(404);
  });

  it('an admin of the project may download; an unmodified file answers 304', async () => {
    const w = await stored();
    const adminGet = await w.call('get', sha(SECRET), { cookie: w.cookies.admin });
    expect(adminGet.status).toBe(200);
    await adminGet.arrayBuffer();
    const r = await w.call('get', sha(PHOTO), {
      cookie: w.cookies.sabine,
      headers: { 'if-none-match': `"${sha(PHOTO)}"` },
    });
    expect(r.status).toBe(304);
    expect(r.headers.get('cache-control')).toBe('private, no-cache');
    // a person without access gets 404 even with a matching ETag: a stale copy cannot be revalidated into view
    const lost = await w.call('get', sha(PHOTO), {
      cookie: w.cookies.bernd,
      headers: { 'if-none-match': `"${sha(PHOTO)}"` },
    });
    expect(lost.status).toBe(404);
  });
});

describe('runs and blobs', () => {
  it('a run naming an unknown sha is refused blob_missing and writes nothing', async () => {
    const w = await world();
    const r = w.runAs(w.actor('mia', 'melder'), 'melden', { kategorie: 'x', foto: [file(PHOTO)] });
    expect(r).toMatchObject({ outcome: 'refused', refusal: { code: 'blob_missing' } });
    expect(w.ctx.db.prepare('SELECT count(*) n FROM observations').get()).toEqual({ n: 0 });
    expect(w.ctx.db.prepare('SELECT count(*) n FROM blob_refs').get()).toEqual({ n: 0 });
    await w.call('put', sha(PHOTO), { cookie: w.cookies.mia, body: PHOTO });
    expect(w.runAs(w.actor('mia', 'melder'), 'melden', { kategorie: 'x', foto: [file(PHOTO)] }).outcome).toBe(
      'accepted',
    );
    expect(w.ctx.db.prepare('SELECT count(*) n FROM blob_refs').get()).toEqual({ n: 1 });
  });

  it('a list of two files: both are checked for upload and both are recorded', async () => {
    const w = await world();
    const mia = w.actor('mia', 'melder');
    const SECOND = Buffer.from('second bytes');
    const two = [file(PHOTO), file(SECOND, 'b.jpg')];
    await w.call('put', sha(PHOTO), { cookie: w.cookies.mia, body: PHOTO });
    expect(w.runAs(mia, 'melden', { kategorie: 'x', foto: two })).toMatchObject({
      outcome: 'refused',
      refusal: { code: 'blob_missing' },
    });
    await w.call('put', sha(SECOND), { cookie: w.cookies.mia, body: SECOND });
    expect(w.runAs(mia, 'melden', { kategorie: 'x', foto: two }).outcome).toBe('accepted');
    expect(w.ctx.db.prepare('SELECT count(*) n FROM blob_refs').get()).toEqual({ n: 2 });
  });
});

describe('thumbnails', () => {
  async function storedImage() {
    const w = await world();
    const src = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#468' } })
      .jpeg()
      .toBuffer();
    await w.call('put', sha(src), { cookie: w.cookies.mia, body: src, type: 'image/jpeg' });
    expect(w.runAs(w.actor('mia', 'melder'), 'melden', { kategorie: 'x', foto: [file(src)] }).outcome).toBe(
      'accepted',
    );
    return { w, src };
  }

  it('serves a WebP thumbnail with an ETag per size', async () => {
    const { w, src } = await storedImage();
    const h = sha(src);
    const res = await w.call('get', h, { cookie: w.cookies.sabine, thumb: 'preview' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('etag')).toBe(`"${h}-preview"`);
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect(meta.format).toBe('webp');
    expect([meta.width, meta.height]).toEqual([800, 500]);
    const list = await w.call('get', h, { cookie: w.cookies.sabine, thumb: 'list' });
    expect(list.status).toBe(200);
    const lm = await sharp(Buffer.from(await list.arrayBuffer())).metadata();
    expect([lm.width, lm.height]).toEqual([80, 80]);
  });

  it('answers 404 to unauthorised callers, even with a matching If-None-Match', async () => {
    const { w, src } = await storedImage();
    const h = sha(src);
    const inm = `"${h}-preview"`;
    expect((await w.call('get', h, { cookie: w.cookies.bernd, thumb: 'list' })).status).toBe(404);
    expect((await w.call('get', h, { thumb: 'list' })).status).toBe(401);
    // the 304 must not be reachable before authorisation
    expect(
      (
        await w.call('get', h, {
          cookie: w.cookies.bernd,
          thumb: 'preview',
          headers: { 'if-none-match': inm },
        })
      ).status,
    ).toBe(404);
    expect((await w.call('get', h, { thumb: 'preview', headers: { 'if-none-match': inm } })).status).toBe(
      401,
    );
  });

  it('answers 404 for non-images without leaving a file behind', async () => {
    const w = await world();
    const text = Buffer.from('not an image');
    await w.call('put', sha(text), { cookie: w.cookies.mia, body: text, type: 'text/plain' });
    expect(w.runAs(w.actor('mia', 'melder'), 'melden', { kategorie: 'x', foto: [file(text)] }).outcome).toBe(
      'accepted',
    );
    expect((await w.call('get', sha(text), { cookie: w.cookies.mia, thumb: 'list' })).status).toBe(404);
    expect(existsSync(join(w.root, 'thumbs'))).toBe(false);
  });

  it('does not answer 404 for an image whose bytes do not decode: the JSON error thumbnail_failed and one log event', async () => {
    const w = await world();
    const junk = Buffer.from('not really a jpeg');
    await w.call('put', sha(junk), { cookie: w.cookies.mia, body: junk, type: 'image/jpeg' });
    expect(w.runAs(w.actor('mia', 'melder'), 'melden', { kategorie: 'x', foto: [file(junk)] }).outcome).toBe(
      'accepted',
    );
    logLines.length = 0;
    const res = await w.call('get', sha(junk), { cookie: w.cookies.mia, thumb: 'list' });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('thumbnail_failed');
    // exactly one structured event, with the cause code and the blob id, nothing personal
    const events = logLines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((e) => e.event === 'blob.thumbnail_failed');
    expect(events).toEqual([
      expect.objectContaining({ level: 'error', code: 'decode_failed', id: sha(junk) }),
    ]);
  });

  it('answers 404 for unknown sizes, including the numeric widths', async () => {
    const { w, src } = await storedImage();
    const h = sha(src);
    for (const thumb of ['160', '800', '80x80', 'abc'])
      expect((await w.call('get', h, { cookie: w.cookies.sabine, thumb })).status).toBe(404);
  });

  it('answers 304 to the thumbnail ETag without generating or reading', async () => {
    const { w, src } = await storedImage();
    const h = sha(src);
    expect(existsSync(join(w.root, 'thumbs', `${h}.preview.webp`))).toBe(false);
    const r = await w.call('get', h, {
      cookie: w.cookies.sabine,
      thumb: 'preview',
      headers: { 'if-none-match': `"${h}-preview"` },
    });
    expect(r.status).toBe(304);
    expect((await r.arrayBuffer()).byteLength).toBe(0);
    // the 304 neither generated nor read: the cache file still does not exist
    expect(existsSync(join(w.root, 'thumbs', `${h}.preview.webp`))).toBe(false);
    // the original blob's ETag is not the thumbnail's: a fresh 200
    const full = await w.call('get', h, {
      cookie: w.cookies.sabine,
      thumb: 'preview',
      headers: { 'if-none-match': `"${h}"` },
    });
    expect(full.status).toBe(200);
    await full.arrayBuffer();
  });
});
