// WP-384 review: zip-bomb defence. Each case is a small, highly compressible archive; the refusal must come from the
// bytes counted while inflating (or from the central directory), so the assertions are on bytes read, never on time.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { golden } from '../../store/run/testkit';
import { importArchive, type ArchiveImportDeps } from './import-zip';
import { ARCHIVE_ENTRIES, ARCHIVE_LIMITS, ARCHIVE_ZIP_LIMITS } from './manifest';
import { ArchiveLimitError, openZip, zipStream, type ZipEntry } from './zip';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const dir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'limits-spec-'));
  dirs.push(d);
  return d;
};

const KIB = 1024;
const MIB = KIB * KIB;
const SMALL = { maxEntryBytes: MIB, maxTotalBytes: MIB, maxTextBytes: 64 * KIB };

/** `bytes` bytes of one character, in 64 KiB chunks: a few KiB once deflated. */
async function* filler(bytes: number, char = 0x61): AsyncGenerator<Uint8Array> {
  const chunk = Buffer.alloc(64 * KIB, char);
  for (let left = bytes; left > 0; left -= chunk.length)
    yield left >= chunk.length ? chunk : chunk.subarray(0, left);
}
const text = (s: string): AsyncGenerator<Uint8Array> =>
  (async function* () {
    yield Buffer.from(s);
  })();

async function build(entries: ZipEntry[]): Promise<string> {
  const parts: Buffer[] = [];
  for await (const c of zipStream(entries)) parts.push(Buffer.from(c));
  const path = join(dir(), 'bomb.zip');
  writeFileSync(path, Buffer.concat(parts));
  return path;
}

/** Makes the central directory declare `size` for `name` (the header lies; the data is what it is). */
function declare(path: string, name: string, size: number): void {
  const raw = readFileSync(path);
  for (let i = 0; i + 46 < raw.length; i++) {
    if (raw.readUInt32LE(i) !== 0x02014b50) continue;
    const len = raw.readUInt16LE(i + 28);
    if (raw.toString('utf8', i + 46, i + 46 + len) !== name) continue;
    raw.writeUInt32LE(size, i + 24);
    writeFileSync(path, raw);
    return;
  }
  throw new Error(`no entry ${name}`);
}

async function read(path: string, limits = SMALL, name = 'a'): Promise<{ seen: number; error: unknown }> {
  let seen = 0;
  try {
    for await (const c of (await openZip(path, limits)).open(name)) seen += c.byteLength;
    return { seen, error: undefined };
  } catch (error) {
    return { seen, error };
  }
}

describe('zip bombs: the codec', () => {
  it('an entry that inflates past its declared size is stopped there, not inflated', async () => {
    const path = await build([{ name: 'a', data: filler(20 * MIB) }]);
    declare(path, 'a', 100 * KIB);
    const { seen, error } = await read(path);
    expect(error).toBeInstanceOf(ArchiveLimitError);
    expect((error as ArchiveLimitError).code).toBe('entry_over_declared');
    expect(seen).toBeLessThanOrEqual(100 * KIB);
  });

  it('a text entry over the text limit is refused before a byte is read', async () => {
    const path = await build([{ name: 'a', data: filler(200 * KIB) }]);
    const zip = await openZip(path, SMALL);
    await expect(zip.text('a')).rejects.toMatchObject({ code: 'text_too_large' });
  });

  it('a text entry whose header lies small is stopped at the declared size', async () => {
    const path = await build([{ name: 'a', data: filler(20 * MIB) }]);
    declare(path, 'a', 10 * KIB);
    const zip = await openZip(path, SMALL);
    await expect(zip.text('a')).rejects.toMatchObject({ code: 'entry_over_declared' });
  });

  it('an entry that declares more than one entry may have is refused when the archive opens', async () => {
    const path = await build([{ name: 'a', data: filler(KIB) }]);
    declare(path, 'a', 2 * MIB);
    await expect(openZip(path, SMALL)).rejects.toMatchObject({ code: 'entry_too_large' });
  });

  it('entries that declare more than the total are refused when the archive opens', async () => {
    const path = await build([
      { name: 'a', data: filler(800 * KIB) },
      { name: 'b', data: filler(800 * KIB) },
    ]);
    await expect(openZip(path, SMALL)).rejects.toMatchObject({ code: 'archive_too_large' });
  });

  it('the total counts every read, so reading one entry again cannot get past it', async () => {
    const path = await build([{ name: 'a', data: filler(600 * KIB) }]);
    const zip = await openZip(path, SMALL);
    let seen = 0;
    for await (const c of zip.open('a')) seen += c.byteLength;
    expect(seen).toBe(600 * KIB);
    let more = 0;
    let error: unknown;
    try {
      for await (const c of zip.open('a')) more += c.byteLength;
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ code: 'archive_too_large' });
    expect(more).toBeLessThan(600 * KIB);
  });
});

describe('zip bombs: the import', () => {
  const file = stringify(golden('musterstadt-plain').file);
  const manifest = JSON.stringify({
    format: 'ueberblick-project-zip',
    version: 1,
    exportedAt: 'x',
    project: { key: 'a', name: 'a', description: '' },
    deployed: true,
    types: { baum: { count: 1 } },
    blobs: { count: 0, bytes: 0 },
  });
  const created: string[] = [];
  const removed: string[] = [];
  const deps: ArchiveImportDeps = {
    createProject: (t) => (created.push(t), { ok: true, key: 'neu', fileText: t }),
    putLive: () => ({ ok: true, version: 1 }),
    removeProject: (key) => void removed.push(key),
    usedTokens: () => new Set(),
    rosterTarget: () => {
      throw new Error('no roster');
    },
    store: () =>
      ({
        submitBatch: () => {
          throw new Error('no data may be entered');
        },
      }) as never,
    blobs: () => {
      throw new Error('no blobs');
    },
    ids: { runId: () => 'r' as never, featureId: () => 'f' as never },
  };
  const archive = (entries: Record<string, AsyncGenerator<Uint8Array>>): Promise<string> =>
    build(Object.entries(entries).map(([name, data]) => ({ name, data })));
  const base = () => ({
    [ARCHIVE_ENTRIES.manifest]: text(manifest),
    [ARCHIVE_ENTRIES.file]: text(file),
    [ARCHIVE_ENTRIES.data('baum')]: text('{}\n'),
  });

  it('a line without a newline, longer than a line may be, is refused with its code (the project it begun is removed)', async () => {
    created.length = 0;
    removed.length = 0;
    const path = await archive({
      ...base(),
      [ARCHIVE_ENTRIES.data('baum')]: filler(ARCHIVE_LIMITS.maxLineBytes + 2 * MIB),
    });
    const r = await importArchive(deps, path);
    expect(r).toMatchObject({ ok: false, problems: [{ code: 'line_too_long' }] });
    expect(r).not.toHaveProperty('key');
    expect(removed).toEqual(['neu']);
  });

  it('a manifest over the text limit is refused with its code and nothing is created', async () => {
    created.length = 0;
    const path = await archive({
      ...base(),
      [ARCHIVE_ENTRIES.manifest]: filler(ARCHIVE_LIMITS.maxTextBytes + MIB),
    });
    const r = await importArchive(deps, path);
    expect(r).toMatchObject({ ok: false, problems: [{ code: 'text_too_large' }] });
    expect(created).toEqual([]);
  });

  it('an entry that declares more than one entry may have is refused with its code and nothing is created', async () => {
    created.length = 0;
    const path = await archive(base());
    declare(path, ARCHIVE_ENTRIES.data('baum'), ARCHIVE_LIMITS.maxEntryBytes + MIB);
    const r = await importArchive(deps, path);
    expect(r).toMatchObject({ ok: false, problems: [{ code: 'entry_too_large' }] });
    expect(created).toEqual([]);
  });

  it('entries that declare more than the whole archive may have are refused with their code', async () => {
    created.length = 0;
    const path = await archive(base());
    const each = ARCHIVE_LIMITS.maxEntryBytes - MIB;
    for (const name of Object.keys(base())) declare(path, name, each);
    const r = await importArchive(deps, path);
    expect(r).toMatchObject({ ok: false, problems: [{ code: 'archive_too_large' }] });
    expect(created).toEqual([]);
  });

  it('an entry that lies about its size is refused with its code', async () => {
    created.length = 0;
    const path = await archive({ ...base(), [ARCHIVE_ENTRIES.file]: filler(2 * MIB) });
    declare(path, ARCHIVE_ENTRIES.file, 1000);
    const r = await importArchive(deps, path);
    expect(r).toMatchObject({ ok: false, problems: [{ code: 'entry_over_declared' }] });
    expect(created).toEqual([]);
  });

  it('every archive limit has a number', () => {
    expect(ARCHIVE_ZIP_LIMITS.maxTotalBytes).toBe(ARCHIVE_LIMITS.maxInflatedBytes);
    expect(ARCHIVE_LIMITS.maxInflatedBytes).toBeLessThanOrEqual(4 * 1024 ** 3);
  });
});
