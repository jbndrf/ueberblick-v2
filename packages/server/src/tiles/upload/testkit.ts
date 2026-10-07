/** Test support for the upload engine: tiny raster tiles, an MBTiles builder and a service over a temp dir. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { zipStream } from '../../io/archive/zip';
import { createDiskStore, type UploadJob } from './store';
import { createTileUploads, type TileUploads } from './service';

const MAGIC = {
  png: [0x89, 0x50, 0x4e, 0x47],
  jpg: [0xff, 0xd8, 0xff, 0xe0],
  webp: [0x52, 0x49, 0x46, 0x46],
} as const;

/** Bytes that sniff as an image of the format and carry a tag, so a test can tell tiles apart. */
export function image(tag: string, format: 'png' | 'jpg' | 'webp' = 'png'): Buffer {
  const head = Buffer.from(MAGIC[format]);
  const tail =
    format === 'webp' ? Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]) : Buffer.alloc(0);
  return Buffer.concat([head, tail, Buffer.from(tag)]);
}

export interface Kit {
  readonly dir: string;
  readonly uploads: TileUploads;
  /** Every job the service saved, in order: progress is asserted on these, never by polling a race. */
  readonly saved: readonly UploadJob[];
  file(name: string, bytes: Uint8Array): string;
  cleanup(): void;
}

let counter = 0;
export function kit(): Kit {
  const dir = mkdtempSync(join(tmpdir(), 'tile-upload-'));
  const disk = createDiskStore((p) => join(dir, 'tiles', p));
  const saved: UploadJob[] = [];
  const store: typeof disk = {
    ...disk,
    writeJob(project, job) {
      saved.push(job);
      disk.writeJob(project, job);
    },
  };
  const uploads = createTileUploads({
    store,
    now: () => '2026-10-03T10:00:00.000Z',
    newId: () => (++counter).toString(16).padStart(16, '0'),
  });
  return {
    dir,
    uploads,
    saved,
    file(name, bytes) {
      writeFileSync(join(dir, name), bytes);
      return join(dir, name);
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export interface MbTile {
  readonly z: number;
  readonly x: number;
  /** XYZ y (the builder flips it to TMS). */
  readonly y: number;
  readonly data: Uint8Array;
}

export function mbtiles(path: string, tiles: readonly MbTile[], meta: Record<string, string> = {}): void {
  const db = new Database(path);
  db.exec(
    'CREATE TABLE metadata (name TEXT, value TEXT); CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)',
  );
  db.exec('CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row)');
  for (const [k, v] of Object.entries({ format: 'png', ...meta }))
    db.prepare('INSERT INTO metadata VALUES (?, ?)').run(k, v);
  const ins = db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)');
  for (const t of tiles) ins.run(t.z, t.x, 2 ** t.z - 1 - t.y, Buffer.from(t.data));
  db.close();
}

/** A full pyramid to `maxZoom`, each tile tagged with its address. */
export function pyramid(maxZoom: number): MbTile[] {
  const out: MbTile[] = [];
  for (let z = 0; z <= maxZoom; z++)
    for (let x = 0; x < 2 ** z; x++)
      for (let y = 0; y < 2 ** z; y++) out.push({ z, x, y, data: image(`${z}/${x}/${y}`) });
  return out;
}

const once = (b: Uint8Array): AsyncIterable<Uint8Array> =>
  (async function* () {
    yield b;
  })();

/** Runs one upload of `bytes` in `chunk`-sized pieces, waits for the job and returns its final status. */
export async function upload(
  k: Kit,
  kind: string,
  bytes: Uint8Array,
  opts: { format?: string; chunk?: number } = {},
) {
  const job = k.uploads.start('demo', { kind, name: 'Luftbild', size: bytes.length, format: opts.format });
  const step = opts.chunk ?? bytes.length;
  for (let at = 0; at < bytes.length; at += step)
    await k.uploads.chunk('demo', job.id, at, once(bytes.subarray(at, at + step)));
  k.uploads.finish('demo', job.id);
  await k.uploads.idle();
  return k.uploads.status('demo', job.id);
}

export const read = (path: string): Uint8Array => new Uint8Array(readFileSync(path));
export { once };

/** The bytes of a ZIP with the given entries (deflated). */
export async function zipOf(entries: Record<string, Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const list = Object.entries(entries).map(([name, bytes]) => ({
    name,
    data: (async function* () {
      yield bytes;
    })(),
  }));
  for await (const c of zipStream(list)) parts.push(c);
  return Buffer.concat(parts);
}
