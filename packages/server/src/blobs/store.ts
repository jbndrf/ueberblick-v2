import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export type ByteSource = AsyncIterable<Uint8Array>;

export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface StoredBlob {
  readonly sha256: string;
  readonly bytes: number;
}

/** Where the bytes live. Filesystem now, S3 later (H1): implementations must stream, never buffer a whole blob. */
export interface BlobStore {
  /** Streams `source` to storage and returns its hash. With `expected`, a different hash rejects and stores nothing. */
  write(source: ByteSource, expected?: string): Promise<StoredBlob>;
  read(sha256: string): ByteSource | undefined;
  has(sha256: string): boolean;
  /** Deletes the bytes of `ids`. Idempotent: an id that is not stored is ignored. Every id is validated before any is deleted. */
  delete(ids: readonly string[]): Promise<void>;
}

export class BlobHashMismatch extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`blob hash mismatch: expected ${expected}, got ${actual}`);
  }
}

export function assertSha256(sha256: string): void {
  if (!SHA256_PATTERN.test(sha256)) throw new Error(`invalid sha256: ${JSON.stringify(sha256)}`);
}

/** Content-addressed files: `<root>/<ab>/<cd>/<sha256>`. Bytes go to a temp file first and are renamed once verified. */
export function fileBlobStore(root: string): BlobStore {
  const dirOf = (sha256: string): string => join(root, sha256.slice(0, 2), sha256.slice(2, 4));
  const pathOf = (sha256: string): string => {
    assertSha256(sha256);
    return join(dirOf(sha256), sha256);
  };
  return {
    has: (sha256) => existsSync(pathOf(sha256)),
    async delete(ids) {
      const paths = ids.map(pathOf); // validates all first
      for (const p of paths) rmSync(p, { force: true });
    },
    read: (sha256) => (existsSync(pathOf(sha256)) ? createReadStream(pathOf(sha256)) : undefined),
    async write(source, expected) {
      if (expected !== undefined) assertSha256(expected);
      const tmpDir = join(root, 'tmp');
      mkdirSync(tmpDir, { recursive: true });
      const tmp = join(tmpDir, randomUUID());
      const out = createWriteStream(tmp);
      out.on('error', () => undefined); // surfaced by the awaits below; a stream destroyed early must not crash the process
      const hash = createHash('sha256');
      let bytes = 0;
      try {
        for await (const chunk of source) {
          hash.update(chunk);
          bytes += chunk.byteLength;
          if (!out.write(chunk)) await once(out, 'drain');
        }
        out.end();
        await once(out, 'finish');
        const sha256 = hash.digest('hex');
        if (expected !== undefined && expected !== sha256) throw new BlobHashMismatch(expected, sha256);
        if (existsSync(pathOf(sha256))) rmSync(tmp);
        else {
          mkdirSync(dirOf(sha256), { recursive: true });
          renameSync(tmp, pathOf(sha256));
        }
        return { sha256, bytes };
      } catch (e) {
        if (!out.closed) {
          out.destroy();
          await once(out, 'close'); // the lazy open of a destroyed stream may still create the file
        }
        rmSync(tmp, { force: true });
        throw e;
      }
    },
  };
}
