import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tilesDir, tileUploadsFor } from './wiring';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('tileUploadsFor', () => {
  it('reads and writes under the Runtime tilesDir, not a path derived from packsDir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tiles-wiring-'));
    dirs.push(dir);
    const id = '0123456789abcdef';
    mkdirSync(join(dir, 'elsewhere', 'demo'), { recursive: true });
    writeFileSync(join(dir, 'elsewhere', 'demo', `${id}.pmtiles`), 'x');
    const rt = {
      tilesDir: (key: string) => join(dir, 'elsewhere', key),
      clock: { now: () => '2026-10-03T10:00:00.000Z' },
    };
    const uploads = tileUploadsFor(rt);
    expect(uploads.archivePath('demo', id)).toBe(join(dir, 'elsewhere', 'demo', `${id}.pmtiles`));
    expect(tileUploadsFor(rt)).toBe(uploads);
    expect(tilesDir('/d', 'demo')).toBe(join('/d', 'blobs', 'tiles', 'demo'));
  });
});
