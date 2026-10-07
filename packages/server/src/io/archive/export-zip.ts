/**
 * "ZIP exportieren" (WP-384): the project file, the folded features of every Objektart and the blobs, as one streamed
 * ZIP (`zipStream`): one feature row and one blob chunk in memory at a time (R14). The bytes of an erased value are
 * gone from `features.properties` already (B-005 blanks the observation and the fold re-derives), and a blob whose
 * bytes an erasure deleted is skipped, so the archive never carries an erased value.
 */
import type { BlobService } from '../../blobs/blobs';
import type { Db } from '../../db/driver';
import { ARCHIVE_ENTRIES, ARCHIVE_FORMAT, ARCHIVE_VERSION, type ArchiveManifest } from './manifest';
import { columnsText, participantLines, rosterCounts, type RosterSource } from './roster';
import { zipStream, type Chunks, type ZipEntry } from './zip';

export interface ArchiveSource {
  /** The project database (read only here). */
  readonly db: Db;
  readonly project: { readonly key: string; readonly name: string; readonly description: string };
  /** The effective project file as YAML text. */
  readonly fileText: string;
  /** False: nothing is deployed, so no data is exported. */
  readonly deployed: boolean;
  readonly blobs: Pick<BlobService, 'get'>;
  /**
   * Present: the archive carries the roster of the project with its login tokens (A-046, sensitive). Absent: no
   * roster entries and no `roster` in the manifest.
   */
  readonly roster?: RosterSource;
  readonly now: () => string;
}

const CHUNK = 64 * 1024;
const PAGE = 500;
const enc = (s: string): Uint8Array => Buffer.from(s, 'utf8');

async function* text(s: string): Chunks {
  yield enc(s);
}

/** Lines to chunks of about 64 KiB. */
async function* batched(lines: Iterable<string>): Chunks {
  let buf = '';
  for (const line of lines) {
    buf += `${line}\n`;
    if (buf.length >= CHUNK) {
      yield enc(buf);
      buf = '';
    }
  }
  if (buf !== '') yield enc(buf);
}

const withoutReserved = (properties: string): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(JSON.parse(properties) as Record<string, unknown>).filter(([k]) => !k.startsWith('$')),
  );

/** Keyset pages, never an open iterator: a run commits between two pages of a slow download (docs/12). */
function* featureLines(db: Db, type: string): Generator<string> {
  const page = db.prepare<{ rid: number; id: string; lifecycle: string; properties: string }>(
    `SELECT rowid AS rid, id, lifecycle, properties FROM features
     WHERE type = ? AND rowid > ? ORDER BY rowid LIMIT ${PAGE}`,
  );
  for (let after = 0; ;) {
    const rows = page.all(type, after);
    for (const r of rows)
      yield JSON.stringify({ id: r.id, lifecycle: r.lifecycle, properties: withoutReserved(r.properties) });
    const last = rows[rows.length - 1];
    if (last === undefined || rows.length < PAGE) return;
    after = last.rid;
  }
}

interface BlobRow {
  readonly sha256: string;
  readonly mime: string;
  readonly bytes: number;
}

/** The blobs whose bytes are still there, in creation order. */
function liveBlobs(src: ArchiveSource): BlobRow[] {
  const rows = src.db
    .prepare<BlobRow>('SELECT sha256, mime, bytes FROM blobs ORDER BY created_at, sha256')
    .all();
  return rows.filter((r) => src.blobs.get(r.sha256) !== undefined);
}

export function archiveManifest(src: ArchiveSource, blobs: readonly BlobRow[]): ArchiveManifest {
  const counts = src.deployed
    ? src.db
        .prepare<{ type: string; n: number }>(
          'SELECT type, count(*) AS n FROM features GROUP BY type ORDER BY type',
        )
        .all()
    : [];
  return {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: src.now(),
    project: src.project,
    deployed: src.deployed,
    types: Object.fromEntries(counts.map((c) => [c.type, { count: c.n }])),
    blobs: { count: blobs.length, bytes: blobs.reduce((n, b) => n + b.bytes, 0) },
    ...(src.roster !== undefined ? { roster: rosterCounts(src.db) } : {}),
  };
}

function* entries(src: ArchiveSource): Generator<ZipEntry> {
  const blobs = src.deployed ? liveBlobs(src) : [];
  const manifest = archiveManifest(src, blobs);
  yield { name: ARCHIVE_ENTRIES.manifest, data: text(JSON.stringify(manifest, null, 2)) };
  yield { name: ARCHIVE_ENTRIES.file, data: text(src.fileText) };
  for (const type of Object.keys(manifest.types))
    yield { name: ARCHIVE_ENTRIES.data(type), data: batched(featureLines(src.db, type)) };
  if (src.roster !== undefined) {
    yield { name: ARCHIVE_ENTRIES.rosterColumns, data: text(columnsText(src.db)) };
    yield { name: ARCHIVE_ENTRIES.rosterParticipants, data: batched(participantLines(src.db, src.roster)) };
  }
  if (blobs.length === 0) return;
  yield { name: ARCHIVE_ENTRIES.blobIndex, data: batched(blobs.map((b) => JSON.stringify(b))) };
  for (const b of blobs) {
    const got = src.blobs.get(b.sha256);
    if (got === undefined) throw new Error(`blob ${b.sha256} vanished during the export`);
    yield { name: ARCHIVE_ENTRIES.blob(b.sha256), data: got.stream, method: 'store' };
  }
}

/** The ZIP of a project as a byte stream. The manifest is read first, so the counts are those of one moment. */
export const exportArchive = (src: ArchiveSource): AsyncGenerator<Uint8Array> => zipStream(entries(src));
