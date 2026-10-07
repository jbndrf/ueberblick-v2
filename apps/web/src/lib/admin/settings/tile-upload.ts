/**
 * The browser side of the "Hochladen" tab (v3 `LayersSection.svelte:296-378` with `lib/upload/chunked-uploader.ts`, over
 * A-044's API `/api/admin/projects/<key>/tiles`): a chunked upload that resumes from the server's `received`, a poll of the
 * conversion job, and the layer an archive becomes. Headless: `fetch` and `wait` come in, so a spec runs without a server or
 * a clock. The first POST is the start, the PUTs send `offset`-addressed chunks, the last POST finishes.
 */
import {
  TILE_UPLOAD_KINDS,
  TILE_UPLOAD_REFUSALS,
  type TileUploadFormat,
  type TileUploadKind,
  type TileUploadRefusal,
  type TileUploadState,
} from '@ueberblick/core';
import type { LayerDraft } from './layers-model';

/** What a failure is: one of the server's typed reasons, or the network. */
export type UploadFailureReason = TileUploadRefusal | 'network' | 'unknown';

export class UploadFailure extends Error {
  constructor(
    readonly reason: UploadFailureReason,
    message = '',
  ) {
    super(message || reason);
  }
}

/** The finished archive (`result` of a done job). */
export interface UploadResultView {
  readonly url: string;
  readonly archive: string;
  readonly format: TileUploadFormat;
  readonly bounds: readonly number[];
  readonly minZoom: number;
  readonly maxZoom: number;
}

/** One job as the status endpoint answers it. */
export interface UploadJobView {
  readonly id: string;
  readonly state: TileUploadState;
  readonly size: number;
  readonly received: number;
  readonly progress: { readonly done: number; readonly total: number };
  readonly result?: UploadResultView;
  readonly error?: { readonly reason: TileUploadRefusal; readonly message: string };
}

type Fetch = typeof fetch;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const root = (project: string): string => `/api/admin/projects/${encodeURIComponent(project)}/tiles`;

/** v3 sent 10 MB chunks; the API takes up to 16 MiB. */
export const CHUNK_BYTES = 8 * 1024 * 1024;
/** v3 `putChunk`: three attempts, a second apart. */
const ATTEMPTS = 3;
const RETRY_MS = 1000;
/** v3 `pollUploadStatus`: every 2 s, 3 s after a network error. */
export const POLL_MS = 2000;
const POLL_RETRY_MS = 3000;

/** The upload kind of a file name (v3's `accept=".zip,.mbtiles,.pmtiles"`), or null. */
export function kindOfFile(name: string): TileUploadKind | null {
  const ext = /\.([a-z]+)$/i.exec(name)?.[1]?.toLowerCase();
  return TILE_UPLOAD_KINDS.entries.find((k) => k.key === ext)?.key ?? null;
}

/** The name a file gives the layer: its file name without the extension (v3 L778-780). */
export const nameOfFile = (name: string): string => name.replace(/\.(zip|mbtiles|pmtiles)$/i, '');

const isReason = (v: unknown): v is TileUploadRefusal =>
  TILE_UPLOAD_REFUSALS.entries.some((r) => r.key === v);

/** The typed refusal of an answer: its reason and, for a bad chunk, the bytes the server has. */
async function refusal(
  res: Response,
): Promise<{ reason: UploadFailureReason; received?: number; message: string }> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: { reason?: unknown; received?: unknown; message?: unknown };
  };
  const e = body.error;
  return {
    reason: isReason(e?.reason) ? e.reason : 'unknown',
    ...(typeof e?.received === 'number' ? { received: e.received } : {}),
    message: typeof e?.message === 'string' ? e.message : '',
  };
}

async function refused(res: Response): Promise<UploadFailure> {
  const r = await refusal(res);
  return new UploadFailure(r.reason, r.message);
}

export interface UploadOptions {
  readonly fetch: Fetch;
  readonly project: string;
  readonly file: File;
  readonly name: string;
  /** Only for a ZIP; MBTiles and PMTiles say their format themselves. */
  readonly format?: TileUploadFormat | undefined;
  readonly chunkBytes?: number;
  /** Bytes the server has, after the start and after each chunk. */
  readonly onProgress?: (loaded: number, total: number) => void;
  readonly wait?: (ms: number) => Promise<void>;
  readonly signal?: AbortSignal;
}

/** What the server has of an upload (for the resume), or null when it cannot be read. */
async function receivedOf(o: UploadOptions, id: string): Promise<number | null> {
  try {
    const res = await o.fetch(`${root(o.project)}/uploads/${id}`);
    if (!res.ok) return null;
    return ((await res.json()) as UploadJobView).received;
  } catch {
    return null;
  }
}

/**
 * Sends the file: start, chunks, finish. A chunk that fails (network, 5xx) or is refused as out of order (409 `received`)
 * is sent again from the offset the server reports, up to three attempts in a row. Returns the upload's id.
 */
export async function uploadFile(o: UploadOptions): Promise<string> {
  const wait = o.wait ?? sleep;
  const kind = kindOfFile(o.file.name);
  if (kind === null) throw new UploadFailure('corrupt');
  const start = await o
    .fetch(`${root(o.project)}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind,
        name: o.name,
        size: o.file.size,
        ...(kind === 'zip' && o.format !== undefined ? { format: o.format } : {}),
      }),
    })
    .catch(() => null);
  if (start === null) throw new UploadFailure('network');
  if (!start.ok) throw await refused(start);
  const id = ((await start.json()) as UploadJobView).id;
  const chunkBytes = o.chunkBytes ?? CHUNK_BYTES;
  const total = o.file.size;
  let offset = 0;
  let failures = 0;
  o.onProgress?.(0, total);
  while (offset < total) {
    if (o.signal?.aborted) throw new UploadFailure('unknown', 'aborted');
    const body = o.file.slice(offset, Math.min(offset + chunkBytes, total));
    let next: number | null = null;
    try {
      const res = await o.fetch(`${root(o.project)}/uploads/${id}?offset=${offset}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body,
      });
      if (res.ok) next = ((await res.json()) as UploadJobView).received;
      else {
        const r = await refusal(res);
        if (res.status !== 409 && res.status < 500) throw new UploadFailure(r.reason, r.message);
        next = r.received ?? null;
      }
    } catch (e) {
      if (e instanceof UploadFailure) throw e;
    }
    if (next !== null && next > offset) {
      offset = next;
      failures = 0;
      o.onProgress?.(offset, total);
      continue;
    }
    failures += 1;
    if (failures >= ATTEMPTS) throw new UploadFailure('network');
    await wait(RETRY_MS);
    offset = next ?? (await receivedOf(o, id)) ?? offset;
  }
  const done = await o.fetch(`${root(o.project)}/uploads/${id}/finish`, { method: 'POST' }).catch(() => null);
  if (done === null) throw new UploadFailure('network');
  if (!done.ok) throw await refused(done);
  return id;
}

export interface WatchOptions {
  readonly fetch: Fetch;
  readonly project: string;
  readonly id: string;
  readonly onJob: (job: UploadJobView) => void;
  readonly wait?: (ms: number) => Promise<void>;
  readonly signal?: AbortSignal;
}

/** Polls the job until it is done or failed (v3 `pollUploadStatus`); a network error waits and asks again. */
export async function watchJob(o: WatchOptions): Promise<UploadJobView> {
  const wait = o.wait ?? sleep;
  for (;;) {
    if (o.signal?.aborted) throw new UploadFailure('unknown', 'aborted');
    try {
      const res = await o.fetch(`${root(o.project)}/uploads/${o.id}`);
      if (res.ok) {
        const job = (await res.json()) as UploadJobView;
        o.onJob(job);
        if (job.state === 'done' || job.state === 'failed') return job;
        await wait(POLL_MS);
        continue;
      }
      if (res.status === 404) throw new UploadFailure('unknown');
    } catch (e) {
      if (e instanceof UploadFailure) throw e;
    }
    await wait(POLL_RETRY_MS);
  }
}

/**
 * The layer a finished archive becomes: an overlay of source type `pmtiles` at the archive's URL, with the archive's zoom
 * range (a raster source's own zoom limits, so the map overzooms past its last level). A vector archive (`pbf`) needs the
 * source layer to draw, which only the admin knows: null, and the tab hands over to the PMTiles tab.
 */
export function layerOfResult(name: string, result: UploadResultView): LayerDraft | null {
  if (result.format === 'pbf') return null;
  return {
    label: name.trim(),
    kind: 'overlay',
    source: { type: 'pmtiles', url: result.url, tile_type: 'raster' },
    minzoom: result.minZoom,
    maxzoom: result.maxZoom,
  };
}

const ARCHIVE_URL = /^\/api\/p\/[^/]+\/tiles\/archives\/([0-9a-f]+)\.pmtiles$/;

/** The archive an uploaded layer's URL points at, or null for any other layer. */
export const archiveOfUrl = (url: string): string | null => ARCHIVE_URL.exec(url)?.[1] ?? null;

/** What removing an archive answered: gone, or still used by these layers and packs. */
export type ArchiveRemoval =
  { readonly ok: true } | { readonly ok: false; readonly references: readonly string[] };

/** `DELETE .../tiles/<archive>` (v3 `deleteLayer` removed the files of an uploaded layer). 409 names the referencing keys. */
export async function removeArchive(f: Fetch, project: string, archive: string): Promise<ArchiveRemoval> {
  try {
    const res = await f(`${root(project)}/${encodeURIComponent(archive)}`, { method: 'DELETE' });
    if (res.ok || res.status === 404) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: { references?: unknown } };
    const refs = body.error?.references;
    return { ok: false, references: Array.isArray(refs) ? refs.map(String) : [] };
  } catch {
    return { ok: false, references: [] };
  }
}
