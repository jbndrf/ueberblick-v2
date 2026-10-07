import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { SESSION_PARTICIPANT_HEADER } from '@ueberblick/core';
import { dirs, PHOTO, sha, world } from './blobs.testkit';

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const AS = (id: string) => ({ [SESSION_PARTICIPANT_HEADER]: id });

describe('files under a turned session (WP-768)', () => {
  it("a PUT made as olga with felix's cookie is a 409: no bytes stored, felix is no uploader", async () => {
    const w = await world();
    const r = await w.call('put', sha(PHOTO), { cookie: w.cookies.bernd, body: PHOTO, headers: AS('olga') });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'session_changed' });
    expect(w.store.has(sha(PHOTO))).toBe(false);
    // bernd never became the uploader: a run naming the hash is refused
    const file = { sha256: sha(PHOTO), name: 'a.jpg', mime: 'image/jpeg' };
    expect(w.runAs(w.actor('bernd', 'melder'), 'melden', { kategorie: 'x', foto: [file] }).outcome).toBe(
      'refused',
    );
  });

  it('GET and HEAD made as another participant are a 409 too', async () => {
    const w = await world();
    await w.call('put', sha(PHOTO), { cookie: w.cookies.mia, body: PHOTO });
    for (const m of ['get', 'head'] as const)
      expect((await w.call(m, sha(PHOTO), { cookie: w.cookies.bernd, headers: AS('mia') })).status).toBe(409);
  });

  it('the same participant, and a request without the header, are served as before', async () => {
    const w = await world();
    const mine = await w.call('put', sha(PHOTO), { cookie: w.cookies.mia, body: PHOTO, headers: AS('mia') });
    expect(mine.status).toBe(201);
    expect(mine.headers.get(SESSION_PARTICIPANT_HEADER)).toBe('mia');
    expect((await w.call('head', sha(PHOTO), { cookie: w.cookies.mia })).status).toBe(200);
  });
});
