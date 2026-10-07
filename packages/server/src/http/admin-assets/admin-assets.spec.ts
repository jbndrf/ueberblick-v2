import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRANDING_ICON_MAX_BYTES } from '@ueberblick/core';
import type { Principal } from '../../auth/contract';
import { createBlobs, fileBlobStore } from '../../blobs';
import { openProjectDb } from '../../db/open';
import { createAdminAssetHandlers } from './handlers';

const ADMIN = { kind: 'admin', id: 'a1' } as unknown as Principal;
const GUEST = { kind: 'participant', id: 'p1' } as unknown as Principal;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

function world() {
  const db = openProjectDb(':memory:', 'demo');
  const blobs = createBlobs({
    db,
    store: fileBlobStore(mkdtempSync(join(tmpdir(), 'asset-'))),
    clock: { now: () => '2026-10-02T10:00:00.000Z' },
  });
  const handlers = createAdminAssetHandlers({
    authorizeAdmin: (p, key) =>
      p === null
        ? new Response('no', { status: 401 })
        : p === GUEST
          ? new Response('no', { status: 403 })
          : { projectKey: key },
    blobs: () => blobs,
  });
  const post = (body: string | Uint8Array | null, type: string | null, principal: Principal | null = ADMIN) =>
    handlers.upload({
      request: new Request('http://x/api/admin/p/demo/assets', {
        method: 'POST',
        ...(body === null ? {} : { body }),
        headers: type === null ? {} : { 'content-type': type },
      }),
      params: { project: 'demo' },
      principal,
    });
  return { blobs, post };
}

describe('POST /api/admin/p/<project>/assets', () => {
  it('stores an image and answers 201 with its sha, bytes and type', async () => {
    const w = world();
    const res = await w.post(PNG, 'image/png');
    expect(res.status).toBe(201);
    const sha = createHash('sha256').update(PNG).digest('hex');
    expect(await res.json()).toEqual({ sha256: sha, bytes: PNG.byteLength, mime: 'image/png' });
    expect(w.blobs.has(sha)).toBe(true);
  });
  it('accepts an SVG', async () => {
    expect((await world().post(SVG, 'image/svg+xml')).status).toBe(201);
  });
  it('refuses a type that is not an image type of the registry (400 invalid_body)', async () => {
    const res = await world().post('hello', 'text/plain');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: 'invalid_body', issues: [{ path: 'content-type' }] },
    });
    expect((await world().post(PNG, null)).status).toBe(400);
  });
  it('refuses bytes that are not the declared image', async () => {
    const res = await world().post('<html>not a png</html>', 'image/png');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'invalid_body', issues: [{ path: 'body' }] } });
  });
  it('refuses a file above the cap (413)', async () => {
    const big = new Uint8Array(BRANDING_ICON_MAX_BYTES + 1);
    big.set(PNG);
    const res = await world().post(big, 'image/png');
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: 'payload_too_large' } });
  });
  it('answers 401 without a session and 403 for a participant', async () => {
    const w = world();
    expect((await w.post(PNG, 'image/png', null)).status).toBe(401);
    expect((await w.post(PNG, 'image/png', GUEST)).status).toBe(403);
  });
  it('an empty body is refused', async () => {
    expect((await world().post(null, 'image/png')).status).toBe(400);
  });
});
