import { describe, expect, it } from 'vitest';
import { uploadLimitRefusal } from './upload-limit';

const post = (length: string | null): Request =>
  new Request('http://localhost/api/x', {
    method: 'POST',
    headers: length === null ? {} : { 'content-length': length },
    body: 'x',
  });

describe('uploadLimitRefusal', () => {
  it('answers 413 for a body above the limit', async () => {
    const res = uploadLimitRefusal(post('1000001'), 1_000_000);
    expect(res?.status).toBe(413);
    expect(await res?.json()).toEqual({ error: 'payload_too_large' });
  });

  it('lets a body at or below the limit through', () => {
    expect(uploadLimitRefusal(post('1000000'), 1_000_000)).toBeUndefined();
    expect(uploadLimitRefusal(post('10'), 1_000_000)).toBeUndefined();
  });

  it('leaves a request without a declared length to the adapter limit', () => {
    expect(uploadLimitRefusal(post(null), 1_000_000)).toBeUndefined();
  });
});
