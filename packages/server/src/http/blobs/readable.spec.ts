import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { dirs, file, PHOTO, SECRET, sha, world } from './blobs.testkit';

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('a run may name a file the actor can already read (WP-774)', () => {
  it('sabine can read the photo mia used: her HEAD says 200, she skips the PUT, her run is accepted', async () => {
    const w = await world();
    await w.call('put', sha(PHOTO), { cookie: w.cookies.mia, body: PHOTO, type: 'image/jpeg' });
    w.runAs(w.actor('mia', 'melder'), 'melden', { kategorie: 'x', foto: [file(PHOTO)] });
    expect((await w.call('head', sha(PHOTO), { cookie: w.cookies.sabine })).status).toBe(200);
    const run = w.runAs(w.actor('sabine', 'sachbearbeiter'), 'melden', {
      kategorie: 'y',
      foto: [file(PHOTO)],
    });
    expect(run.outcome).toBe('accepted');
  });

  it('H7 still holds: bytes the actor can neither read nor did upload are refused', async () => {
    const w = await world();
    await w.call('put', sha(SECRET), { cookie: w.cookies.mia, body: SECRET, type: 'image/jpeg' });
    const run = w.runAs(w.actor('sabine', 'sachbearbeiter'), 'melden', {
      kategorie: 'y',
      foto: [file(SECRET)],
    });
    expect(run).toMatchObject({ outcome: 'refused', refusal: { code: 'not_permitted' } });
    // bernd (melder) cannot read the photo of mia's feature (property `foto` is for sachbearbeiter only)
    w.runAs(w.actor('mia', 'melder'), 'melden', { kategorie: 'x', foto: [file(PHOTO)] });
    const own = w.runAs(w.actor('bernd', 'melder'), 'melden', { kategorie: 'y', foto: [file(PHOTO)] });
    expect(own.outcome).toBe('refused');
  });
});
