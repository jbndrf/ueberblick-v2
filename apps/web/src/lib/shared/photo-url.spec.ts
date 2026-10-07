import { describe, expect, it } from 'vitest';
import { serverPhotoUrl } from './photo-url';

const SHA = 'b'.repeat(64);

describe('serverPhotoUrl(project) (WP-743)', () => {
  it('builds the thumbnail URL and the original URL of the project blob', () => {
    const resolve = serverPhotoUrl('baeume');
    expect(resolve(SHA, 'list')).toBe(`/api/p/baeume/blobs/${SHA}?thumb=list`);
    expect(resolve(SHA, 'preview')).toBe(`/api/p/baeume/blobs/${SHA}?thumb=preview`);
    expect(resolve.original(SHA)).toBe(`/api/p/baeume/blobs/${SHA}`);
  });

  it('encodes the project key', () => {
    expect(serverPhotoUrl('a b').original(SHA)).toBe(`/api/p/a%20b/blobs/${SHA}`);
  });
});
