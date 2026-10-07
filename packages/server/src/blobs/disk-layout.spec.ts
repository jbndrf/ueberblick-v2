import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileBlobStore } from './store';

// WP-492 (verify step 1): uploaded files sit on disk by their content hash, with no name of their own.
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
async function* once(b: Buffer): AsyncGenerator<Uint8Array> {
  yield b;
}
const tempRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'ub-disk-'));
  dirs.push(root);
  return root;
};

describe('files on disk', () => {
  it('a file lives at <root>/<ab>/<cd>/<sha256> and holds exactly the uploaded bytes', async () => {
    const root = tempRoot();
    const bytes = Buffer.from('a photo, pretend');
    const sha = createHash('sha256').update(bytes).digest('hex');
    const stored = await fileBlobStore(root).write(once(bytes));
    expect(stored).toEqual({ sha256: sha, bytes: bytes.length });
    const path = join(root, sha.slice(0, 2), sha.slice(2, 4), sha);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path)).toEqual(bytes);
  });

  it('the same bytes written again leave one file and no temporary leftovers', async () => {
    const root = tempRoot();
    const store = fileBlobStore(root);
    await store.write(once(Buffer.from('same')));
    await store.write(once(Buffer.from('same')));
    const left = readdirSync(root, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
    expect(left).toHaveLength(1);
  });
});
