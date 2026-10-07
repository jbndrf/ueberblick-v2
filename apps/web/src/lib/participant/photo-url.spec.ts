import { describe, expect, it, vi } from 'vitest';
import { createPendingBlobs } from './blobs';
import { createPhotoUrl, type PhotoUrlDeps } from './photo-url';

const SHA = 'a'.repeat(64);

function setup(over: Partial<PhotoUrlDeps> = {}) {
  const created: Blob[] = [];
  const revoked: string[] = [];
  const deps: PhotoUrlDeps = {
    project: 'baeume',
    pending: createPendingBlobs(),
    stored: { has: () => false, getBlob: async () => undefined },
    createObjectUrl: (b) => {
      created.push(b);
      return `blob:${String(created.length)}`;
    },
    revokeObjectUrl: (u) => void revoked.push(u),
    ...over,
  };
  return { photoUrl: createPhotoUrl(deps), deps, created, revoked };
}

describe('photoUrl(sha, size)', () => {
  it('a thumbnail kept by Offline-Bilder shows from the device, for both sizes, before the server', async () => {
    const get = vi.fn(async () => new Blob([new Uint8Array([9])], { type: 'image/webp' }));
    const { photoUrl, created } = setup({ thumbs: { get } });
    expect(await photoUrl(SHA, 'list')).toBe('blob:1');
    expect(await photoUrl(SHA, 'preview')).toBe('blob:1');
    expect(created).toHaveLength(1);
  });

  it('without a kept thumbnail (the switch is off) it is the server URL, never a made-up image', async () => {
    const { photoUrl } = setup({ thumbs: { get: async () => undefined } });
    expect(await photoUrl(SHA, 'list')).toBe(`/api/p/baeume/blobs/${SHA}?thumb=list`);
  });

  it('names the original blob as the fallback for a thumbnail that does not load (WP-708)', () => {
    const { photoUrl } = setup();
    expect(photoUrl.original?.(SHA)).toBe(`/api/p/baeume/blobs/${SHA}`);
  });

  it('a sent photo comes from the server thumbnail URL of that size', async () => {
    const { photoUrl, created } = setup();
    expect(await photoUrl(SHA, 'list')).toBe(`/api/p/baeume/blobs/${SHA}?thumb=list`);
    expect(await photoUrl(SHA, 'preview')).toBe(`/api/p/baeume/blobs/${SHA}?thumb=preview`);
    expect(created).toEqual([]);
  });

  it('an unsent photo still held by the tool shows from its bytes', async () => {
    const pending = createPendingBlobs();
    await pending.put(SHA, new Blob([new Uint8Array([1])]), 'image/jpeg');
    const { photoUrl, created } = setup({ pending });
    expect(await photoUrl(SHA, 'list')).toBe('blob:1');
    expect(created[0]?.type).toBe('image/jpeg');
  });

  it('a photo queued with a run (after the form closed or a reload) shows from the stored bytes', async () => {
    const getBlob = vi.fn(async () => new Uint8Array([7, 7]));
    const { photoUrl, created } = setup({ stored: { has: (s) => s === SHA, getBlob } });
    expect(await photoUrl(SHA, 'preview')).toBe('blob:1');
    expect(getBlob).toHaveBeenCalledWith(SHA);
    expect(created).toHaveLength(1);
  });

  it('one object URL per photo, whatever the size or how often it is asked', async () => {
    const { photoUrl, created } = setup({
      stored: { has: () => true, getBlob: async () => new Uint8Array([1]) },
    });
    const a = await photoUrl(SHA, 'list');
    const b = await photoUrl(SHA, 'preview');
    const c = await Promise.all([photoUrl(SHA, 'list'), photoUrl(SHA, 'list')]);
    expect([a, b, ...c]).toEqual(Array(4).fill('blob:1'));
    expect(created).toHaveLength(1);
  });

  it('once the bytes are gone from the device (sent and purged) it falls back to the server', async () => {
    let on = true;
    const { photoUrl } = setup({
      stored: { has: () => on, getBlob: async () => (on ? new Uint8Array([1]) : undefined) },
    });
    expect(await photoUrl(SHA, 'list')).toBe('blob:1');
    on = false;
    const second = setup({ stored: { has: () => true, getBlob: async () => undefined } });
    expect(await second.photoUrl(SHA, 'list')).toBe(`/api/p/baeume/blobs/${SHA}?thumb=list`);
  });

  it('dispose revokes every object URL it made', async () => {
    const { photoUrl, revoked } = setup({
      stored: { has: () => true, getBlob: async () => new Uint8Array([1]) },
    });
    await photoUrl(SHA, 'list');
    await photoUrl('b'.repeat(64), 'list');
    photoUrl.dispose();
    expect(revoked).toEqual(['blob:1', 'blob:2']);
  });
});
