/**
 * The project ZIP (WP-384): what is in it and how the manifest names it. The format is versioned; an importer refuses a
 * version it does not know. The data is the **folded features** (current state, every lifecycle state), not the
 * observation log: it re-imports through `$seed` runs (R3) and reproduces the fold exactly, whereas a log can only
 * enter through the runs that wrote it (docs/03 "Project ZIP").
 *
 *   manifest.json            format, version, project, counts
 *   project.yaml             the effective project file (the deployed version; the draft when nothing is deployed)
 *   data/<type>.ndjson       one feature per line: { id, lifecycle, properties }
 *   blobs.ndjson             one blob per line: { sha256, mime, bytes }
 *   blobs/<sha256>           the bytes (stored, not compressed)
 *   roster/columns.json      the custom columns of the Teilnehmende table (version 2, A-046)
 *   roster/participants.ndjson  one participant per line, with the login token as the server stores it (version 2)
 *
 * The roster entries make the file **sensitive**: it holds login credentials. An archive of version 1 has no roster.
 */
import { z } from '@ueberblick/core/zod';

export const ARCHIVE_FORMAT = 'ueberblick-project-zip';
export const ARCHIVE_VERSION = 2;

/**
 * The numbers an archive is held to. The upload is streamed to disk and every entry is inflated as a stream, so each
 * cap is enforced while the bytes flow (`zip.ts`), never trusted from a header:
 * - `maxBytes`: the compressed upload, 2 GiB (the codec has no Zip64, so 4 GiB is its own ceiling).
 * - `maxInflatedBytes`: all entries together, 4 GiB. Blobs are stored uncompressed and the data compresses about 10 to
 *   1, so a real archive inflates to about its upload size; 4 GiB is twice the upload cap and leaves room for the text.
 *   A bomb is far above it (zeros inflate 1000 to 1) and is stopped at the cap, so it cannot fill the disk.
 * - `maxEntryBytes`: one entry, 2 GiB (a blob up to the upload size).
 * - `maxTextBytes`: an entry held in memory as text (`manifest.json`, `project.yaml`), 4 MiB (a project file is 1 MiB at most).
 * - `maxLineBytes`: one NDJSON line (one feature or blob row), 4 MiB, so a file without newlines cannot grow a buffer.
 */
export const ARCHIVE_LIMITS = {
  maxBytes: 2 * 1024 ** 3,
  maxInflatedBytes: 4 * 1024 ** 3,
  maxEntryBytes: 2 * 1024 ** 3,
  maxTextBytes: 4 * 1024 ** 2,
  maxLineBytes: 4 * 1024 ** 2,
} as const;

/** What `openZip` takes (the same numbers; the total is named differently there). */
export const ARCHIVE_ZIP_LIMITS = {
  maxEntryBytes: ARCHIVE_LIMITS.maxEntryBytes,
  maxTotalBytes: ARCHIVE_LIMITS.maxInflatedBytes,
  maxTextBytes: ARCHIVE_LIMITS.maxTextBytes,
} as const;

/**
 * Typed refusals of an archive that is too large. The dialog shows them in de and en
 * (`admin_projects_import_archive_code_<key>`). The first four are the codec's `ARCHIVE_LIMIT_CODES`.
 */
export const ARCHIVE_PROBLEM_CODES = {
  entry_too_large: 'An entry declares more bytes than one entry may have.',
  archive_too_large: 'The entries together are larger than an archive may be.',
  entry_over_declared: 'An entry inflates past the size its header declares.',
  text_too_large: 'A text entry (manifest or project file) is larger than allowed.',
  line_too_long: 'A line of a data file is longer than allowed.',
  token_duplicate: 'A login token appears twice inside the archive (a corrupt archive).',
} as const;
export type ArchiveProblemCode = keyof typeof ARCHIVE_PROBLEM_CODES;

export const ARCHIVE_ENTRIES = {
  manifest: 'manifest.json',
  file: 'project.yaml',
  blobIndex: 'blobs.ndjson',
  data: (type: string): string => `data/${type}.ndjson`,
  blob: (sha256: string): string => `blobs/${sha256}`,
  rosterColumns: 'roster/columns.json',
  rosterParticipants: 'roster/participants.ndjson',
} as const;

export const ArchiveManifestSchema = z.object({
  format: z.literal(ARCHIVE_FORMAT),
  version: z.number().int().min(1),
  exportedAt: z.string(),
  project: z.object({ key: z.string(), name: z.string(), description: z.string() }),
  /** False: the project was never deployed, so the archive holds the draft and no data. */
  deployed: z.boolean(),
  /** Features per Objektart, every lifecycle state. */
  types: z.record(z.string(), z.object({ count: z.number().int().min(0) })),
  blobs: z.object({ count: z.number().int().min(0), bytes: z.number().int().min(0) }),
  /** Absent in a version 1 archive and when the exporter had no roster: nothing to restore. */
  roster: z.object({ participants: z.number().int().min(0), columns: z.number().int().min(0) }).optional(),
});
export type ArchiveManifest = z.infer<typeof ArchiveManifestSchema>;

export const ArchiveFeatureSchema = z.object({
  id: z.string(),
  lifecycle: z.string(),
  properties: z.record(z.string(), z.unknown()),
});
export const ArchiveBlobSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  mime: z.string(),
  bytes: z.number().int().min(0),
});

/** A name safe in a download header: umlauts spelled out, the rest folded to `a-z0-9` and dashes (v3 `slugify`). */
export const fileSlug = (name: string): string =>
  name
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'projekt';

/** The download name (v3 `export-archive`: the lower-cased project name with dashes). */
export const archiveFilename = (projectName: string): string => `${fileSlug(projectName)}.zip`;
