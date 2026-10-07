/**
 * The bytes of files a tool produced (photo), held until the run that refers to them is stored. The device store keeps
 * a blob only together with its run (`appendRuns`), so a tool's `BlobPort.put` parks the bytes here and the submitter
 * attaches them by the `sha256` in the run input.
 */
import type { BlobInput } from '@ueberblick/client';
import type { Json } from '@ueberblick/core/model';
import type { BlobPort } from '@ueberblick/ui/tool-api';

/** Durable place for the bytes of photos in drafts (WP-811); `blob-shelf.ts` is the IndexedDB one. */
export interface BlobShelf {
  /** Keeps the bytes for the draft `draftKey`; one photo in two drafts is one row held by both. */
  put(sha256: string, blob: Blob, mime: string, draftKey: string): Promise<void>;
  get(sha256: string): Promise<{ readonly blob: Blob; readonly mime: string } | undefined>;
  /** The draft lets go of the photo; the bytes go when no other draft holds them. */
  remove(sha256: string, draftKey: string): Promise<void>;
  /** Drops the claims of drafts that no longer exist (`isLive` false) and the bytes nobody holds any more. */
  sweep(isLive: (draftKey: string) => boolean): Promise<void>;
  /** Closes the database connection (sign-out must be able to delete it). */
  close(): void;
}

export interface PendingBlobs extends BlobPort {
  /** The held bytes of one file, for showing it before its run is stored (WP-630). */
  peek(sha256: string): { readonly blob: Blob; readonly mime: string } | undefined;
  /** The bytes of every file value (`{ sha256 }`) found in `input`, for the run that carries it. */
  take(input: Readonly<Record<string, Json>>): Promise<readonly BlobInput[]>;
  /** Draft saved: the bytes of its file values go to the shelf. Rejects when they cannot be kept. */
  persist(draftKey: string, values: Readonly<Record<string, Json>>): Promise<void>;
  /**
   * Draft opened after a reload: the shelf's bytes of its file values are held again. Returns the hashes whose bytes
   * could not be restored (not on the shelf, or the shelf cannot be read); the caller must not show those as present.
   */
  restore(values: Readonly<Record<string, Json>>): Promise<readonly string[]>;
  /** Closes the shelf's database connection. */
  close(): void;
  /** Draft discarded or sent (the queue owns the bytes then): its claim on the shelf copies goes. Idempotent. */
  forget(draftKey: string, values: Readonly<Record<string, Json>>): Promise<void>;
  /** Once per shelf open: removes what drafts that no longer exist (a forget that failed) left behind. */
  sweep(isLive: (draftKey: string) => boolean): Promise<void>;
}

export type DraftBlobs = Pick<PendingBlobs, 'persist' | 'restore' | 'forget' | 'sweep'>;

const SHA256 = /^[0-9a-f]{64}$/;

/** `sha256` of every file value in a run input: a `file` value is an object with a sha256, or a list of them. */
export function fileHashes(input: Readonly<Record<string, Json>>): readonly string[] {
  const found: string[] = [];
  const visit = (v: Json): void => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (typeof v === 'object' && v !== null) {
      const sha = (v as { readonly sha256?: unknown }).sha256;
      if (typeof sha === 'string' && SHA256.test(sha)) found.push(sha);
    }
  };
  Object.values(input).forEach(visit);
  return found;
}

/** `values` without the file values whose hash is in `missing` (a list loses the entries, a single value its key). */
export function withoutFiles(
  values: Readonly<Record<string, Json>>,
  missing: readonly string[],
): Record<string, Json> {
  if (missing.length === 0) return { ...values };
  const gone = new Set(missing);
  const isGone = (v: Json): boolean =>
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    gone.has((v as { readonly sha256?: string }).sha256 ?? '');
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(values)) {
    if (Array.isArray(v)) out[key] = v.filter((e) => !isGone(e));
    else if (!isGone(v)) out[key] = v;
  }
  return out;
}

/**
 * `onDevice` says whether the device store already keeps the bytes of a hash (a resubmitted run): only then may `take`
 * leave a hash out. A hash that is neither held nor stored is a photo the run would reference without carrying.
 */
export function createPendingBlobs(
  shelf?: BlobShelf,
  onDevice: (sha256: string) => boolean = () => false,
): PendingBlobs {
  const held = new Map<string, { blob: Blob; mime: string }>();
  return {
    async persist(draftKey, values) {
      if (shelf === undefined) return;
      for (const sha256 of new Set(fileHashes(values))) {
        const entry = held.get(sha256);
        if (entry !== undefined) await shelf.put(sha256, entry.blob, entry.mime, draftKey);
      }
    },
    async restore(values) {
      const missing: string[] = [];
      for (const sha256 of new Set(fileHashes(values))) {
        if (held.has(sha256)) continue;
        const kept = await shelf?.get(sha256).catch(() => undefined);
        if (kept === undefined) missing.push(sha256);
        else held.set(sha256, kept);
      }
      return missing;
    },
    close: () => shelf?.close(),
    async forget(draftKey, values) {
      if (shelf === undefined) return;
      for (const sha256 of new Set(fileHashes(values))) await shelf.remove(sha256, draftKey);
    },
    sweep: async (isLive) => shelf?.sweep(isLive),
    async put(sha256, bytes, mime) {
      held.set(sha256, { blob: bytes, mime });
    },
    peek: (sha256) => held.get(sha256),
    async take(input) {
      const out: BlobInput[] = [];
      for (const sha256 of new Set(fileHashes(input))) {
        const entry = held.get(sha256);
        if (entry === undefined) {
          if (onDevice(sha256)) continue; // a resubmitted run: the device already keeps the bytes
          throw new Error(
            `The photo ${sha256} is missing: its bytes are neither held nor stored on this device`,
          );
        }
        out.push({
          sha256,
          bytes: new Uint8Array(await entry.blob.arrayBuffer()),
          mime: entry.mime,
        });
      }
      return out;
    },
  };
}
