// WP-604: an erasure removes the blob_refs rows together with the values that named the blobs.
import { describe, expect, it } from 'vitest';
import { eraseRun, world } from '../store/run/erasure.testkit';

describe('erasure and blob_refs', () => {
  it('removes the rows of the erased values', () => {
    const { c } = world();
    const count = (): number =>
      (c.db.prepare<{ n: number }>('SELECT count(*) n FROM blob_refs').get() as { n: number }).n;
    expect(count()).toBe(1);
    expect(c.store.submit(eraseRun(c)).outcome).toBe('accepted');
    expect(count()).toBe(0);
  });
});
