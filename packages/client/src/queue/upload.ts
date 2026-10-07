/**
 * Uploads the files of one queue entry before its run is sent (WP-605), one file at a time (no base64, one
 * body in flight). A file that was PUT is remembered on its run row (`uploaded`), so a retry skips it (WP-803). Bytes on the device go straight to `put` (idempotent on the server, so no `has` probe:
 * its 404 would be a console error on every new photo, WP-785); only when the bytes are gone does `has`
 * ask whether the server still holds them. The bytes stay in the store whatever happens, so a refused
 * run can still be edited ("Bearbeiten") and resubmitted.
 */
import type { Refusal, RunId } from '@ueberblick/core/model';
import type { BlobTransport, QueueStore } from './contract';
import type { Entry } from './entries';

export type UploadOutcome =
  | { readonly kind: 'done' }
  | { readonly kind: 'refused'; readonly refusal: Refusal }
  | { readonly kind: 'transient'; readonly reason: string };

const refusal = (code: string, sha256: string, what: string): UploadOutcome => ({
  kind: 'refused',
  refusal: { code, message: `file ${sha256}: ${what}`, path: sha256 },
});

export async function uploadEntry(
  store: Pick<QueueStore, 'getBlob' | 'settleRuns'>,
  transport: BlobTransport,
  entry: Entry,
  remember: (runId: RunId, uploaded: readonly string[]) => void = () => undefined,
): Promise<UploadOutcome> {
  const seen = new Set<string>();
  try {
    for (const row of entry.runs) {
      const uploaded = new Set(row.uploaded ?? []);
      for (const sha256 of row.blobs) {
        if (seen.has(sha256)) continue;
        seen.add(sha256);
        if (uploaded.has(sha256)) continue;
        const bytes = await store.getBlob(sha256);
        const mime = row.blobMimes[sha256];
        if (bytes === undefined || mime === undefined) {
          if (await transport.has(sha256)) continue;
          return refusal('blob_lost', sha256, 'the bytes (or mime) are no longer on the device');
        }
        const result = await transport.put(sha256, bytes, mime);
        if (result === 'mismatch') return refusal('blob_mismatch', sha256, 'bytes do not match the hash');
        if (result === 'too_large') return refusal('blob_too_large', sha256, 'over the upload limit');
        // Remembered with the row, so a retry after a later failure does not send these bytes again (WP-803).
        uploaded.add(sha256);
        await store.settleRuns([{ runId: row.run.id, state: row.state, uploaded: [...uploaded] }]);
        remember(row.run.id, [...uploaded]);
      }
    }
  } catch (error) {
    return { kind: 'transient', reason: error instanceof Error ? error.message : String(error) };
  }
  return { kind: 'done' };
}
