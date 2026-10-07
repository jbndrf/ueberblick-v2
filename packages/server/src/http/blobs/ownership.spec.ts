import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dirs, file, PHOTO, SECRET, sha, world } from './blobs.testkit';

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('a file hash in a run needs the actor to own it (WP-757)', () => {
  const put = (
    w: Awaited<ReturnType<typeof world>>,
    who: keyof Awaited<ReturnType<typeof world>>['cookies'],
    b: Buffer,
  ) => w.call('put', sha(b), { cookie: w.cookies[who], body: b, type: 'image/jpeg' });

  it('H7: bernd names a hash only mia uploaded and used: the run is refused and he still cannot download', async () => {
    const w = await world();
    await put(w, 'mia', PHOTO);
    expect(w.runAs(w.actor('mia', 'melder'), 'melden', { kategorie: 'x', foto: [file(PHOTO)] }).outcome).toBe(
      'accepted',
    );
    expect((await w.call('get', sha(PHOTO), { cookie: w.cookies.bernd })).status).toBe(404);
    const attack = w.runAs(w.actor('bernd', 'melder'), 'melden', { kategorie: 'y', foto: [file(PHOTO)] });
    expect(attack).toMatchObject({ outcome: 'refused', refusal: { code: 'not_permitted' } });
    expect((await w.call('get', sha(PHOTO), { cookie: w.cookies.bernd })).status).toBe(404);
  });

  it('two participants uploading identical bytes each use them in their own run', async () => {
    const w = await world();
    await put(w, 'mia', PHOTO);
    await put(w, 'bernd', PHOTO);
    // one blob on disk, deduped by sha256 (WP-797); w.root is the testkit mkdtemp root, not the repo tree
    const h = sha(PHOTO);
    expect(readdirSync(join(w.root, h.slice(0, 2), h.slice(2, 4)))).toEqual([h]);
    for (const who of ['mia', 'bernd'])
      expect(w.runAs(w.actor(who, 'melder'), 'melden', { kategorie: 'x', foto: [file(PHOTO)] }).outcome).toBe(
        'accepted',
      );
  });

  it('a retried upload and a retried run keep working', async () => {
    const w = await world();
    expect((await put(w, 'mia', PHOTO)).status).toBe(201);
    expect((await put(w, 'mia', PHOTO)).status).toBe(201);
    const run = w.ctx.run('melden', w.actor('mia', 'melder'), {
      kategorie: 'x',
      foto: [file(PHOTO)],
    } as never);
    expect(w.ctx.store.submit(run).outcome).toBe('accepted');
    expect(w.ctx.store.submit(run).outcome).toBe('accepted');
  });

  it('PUT answers alike for new and existing bytes, and needs the real bytes to count as uploader', async () => {
    const w = await world();
    const fresh = await put(w, 'mia', PHOTO);
    const known = await put(w, 'bernd', PHOTO);
    expect(known.status).toBe(fresh.status);
    // bernd cannot become an uploader of SECRET by sending other bytes under its hash
    await put(w, 'mia', SECRET);
    const fake = await w.call('put', sha(SECRET), { cookie: w.cookies.bernd, body: PHOTO });
    expect(fake.status).toBe(409);
    expect(
      w.runAs(w.actor('bernd', 'melder'), 'melden', { kategorie: 'y', foto: [file(SECRET)] }).outcome,
    ).toBe('refused');
  });

  it('HEAD answers for what the caller uploaded or may read, otherwise like a missing file', async () => {
    const w = await world();
    await put(w, 'mia', PHOTO);
    expect((await w.call('head', sha(PHOTO), { cookie: w.cookies.mia })).status).toBe(200);
    expect((await w.call('head', sha(PHOTO), { cookie: w.cookies.bernd })).status).toBe(404);
    expect((await w.call('head', sha(SECRET), { cookie: w.cookies.bernd })).status).toBe(404);
    w.runAs(w.actor('mia', 'melder'), 'melden', { kategorie: 'x', foto: [file(PHOTO)] });
    expect((await w.call('head', sha(PHOTO), { cookie: w.cookies.sabine })).status).toBe(200);
  });
});
