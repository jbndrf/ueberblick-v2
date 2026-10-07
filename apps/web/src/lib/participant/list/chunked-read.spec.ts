import { describe, expect, it } from 'vitest';
import type { ListRow } from '../view-source';
import { createChunkedReader } from './chunked-read';

const row = (i: number): ListRow => ({ id: `f${i}` as ListRow['id'], name: `n${i}`, properties: {} });
const rows = Array.from({ length: 25 }, (_, i) => row(i));
function* slices(size: number): Generator<readonly ListRow[]> {
  for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
}

describe('chunked Liste read (WP-805)', () => {
  it('yields the same rows, in order, as the full read', async () => {
    const got = await createChunkedReader().read(slices(4), (s) => s);
    expect(got).toEqual(rows);
  });
  it('a second read cancels the first', async () => {
    const r = createChunkedReader();
    const first = r.read(slices(5), (s) => s);
    const second = r.read(slices(5), (s) => s);
    expect(await first).toBeUndefined();
    expect(await second).toEqual(rows);
    expect(r.running).toBe(false);
  });
});
