/**
 * `PUT | HEAD | GET /api/p/<project>/blobs/<sha256>` (WP-604): a device uploads a file's bytes BEFORE the run that
 * names them, and whoever may see a file value downloads it. Bytes live on the local disk (`BlobStore`). The URL is
 * content-addressed and per project, so it stays stable for external clients (H6).
 *
 * - PUT: 201 (new or already stored: the bytes are always read and hashed, the caller is recorded as an uploader), 409 the bytes do not hash to the path, 413 over the limit, 401 / 403 as ever.
 * - HEAD: 200 / 404 ("has it", for a resumable upload) for a file the caller uploaded or may read; any other is 404.
 * - GET: 200 with `ETag` = sha and `private, no-cache` (revalidated each time, WP-770); 404 when absent OR not allowed (existence is not revealed).
 * - GET `?thumb=<size>`: 200 WebP with `ETag` = sha-size; 304 on an exact If-None-Match match (after
 *   authorisation, without generating or reading); 404 like the original for unknown sizes and non-images; an image that cannot be made into a thumbnail answers the JSON error
 *   `thumbnail_failed` (500, one `blob.thumbnail_failed` log event with its cause code; never a 404; the client then shows the original).
 */
import { Readable } from 'node:stream';
import { THUMB_SIZES, type Clock, type ThumbSizeKey } from '@ueberblick/core';
import { BlobHashMismatch, createBlobs, SHA256_PATTERN, type BlobStore, type ByteSource } from '../../blobs';
import { THUMB_MIME, ThumbnailFailed, type Thumbnails } from '../../blobs/thumbs';
import type { Logger } from '../../log';
import type { Db } from '../../db/driver';
import type { ConfigResolver } from '../../store/run/config-for';
import type { DeployedConfig } from '../../sync';
import { authorizeProject, DEVICE_KINDS } from '../shared/access';
import {
  DEFAULT_BLOB_LIMITS,
  type BlobLimits,
  type Handler,
  type ProjectAccessDeps,
} from '../shared/contract';
import { withParticipant } from '../shared/session-participant';
import { errorResponse } from '../shared/errors';
import { createBlobUploads } from '../../store/blobs/uploads';
import { createBlobAccess } from './access';

export interface BlobsDeps extends ProjectAccessDeps {
  readonly clock: Clock;
  projectDb(key: string): Db;
  /** The project's bytes (`<dataDir>/blobs/<project>`). */
  store(key: string): BlobStore;
  deployed(key: string): DeployedConfig | undefined;
  /** The project's version resolver (its sync service's): blob access judges a file under its feature's version. */
  versions(key: string): ConfigResolver;
  /** The project's derived thumbnails (`?thumb=`). */
  thumbs(key: string): Thumbnails;
  /** The process logger: a thumbnail failure is logged once as `blob.thumbnail_failed` (WP-720). */
  readonly log: Logger;
  readonly limits?: Partial<BlobLimits>;
}

type Params = { readonly project: string; readonly sha: string };

export interface BlobHandlers {
  readonly put: Handler<Params>;
  readonly head: Handler<Params>;
  readonly get: Handler<Params>;
}

class TooLarge extends Error {}

const DEFAULT_MIME = 'application/octet-stream';
const MAX_MIME = 255;

/** The request body as chunks, cut with `TooLarge` once it is over `max` bytes. Never buffers. */
async function* capped(body: ReadableStream<Uint8Array>, max: number): ByteSource {
  let size = 0;
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > max) throw new TooLarge();
    yield chunk;
  }
}

export function createBlobHandlers(deps: BlobsDeps): BlobHandlers {
  const limits: BlobLimits = { ...DEFAULT_BLOB_LIMITS, ...deps.limits };
  const services = new Map<string, ReturnType<typeof forProject>>();
  function forProject(key: string) {
    const db = deps.projectDb(key);
    return {
      blobs: createBlobs({ db, store: deps.store(key), clock: deps.clock }),
      uploads: createBlobUploads(db, deps.clock),
      access: createBlobAccess({
        db,
        clock: deps.clock,
        deployed: () => deps.deployed(key)?.version,
        versions: deps.versions(key),
        configBlobs: () => {
          const icon = deps.deployed(key)?.config.file.branding?.icon;
          return icon === undefined ? [] : [icon];
        },
      }),
    };
  }
  const of = (key: string) => {
    let s = services.get(key);
    if (s === undefined) services.set(key, (s = forProject(key)));
    return s;
  };
  const notFound = (): Response => errorResponse('not_found', 'No such file.');

  const put: BlobHandlers['put'] = async (req, ctx) => {
    const caller = authorizeProject(deps, req, ctx.params.project, DEVICE_KINDS);
    if (caller instanceof Response) return caller;
    const sha = ctx.params.sha;
    if (!SHA256_PATTERN.test(sha)) return notFound();
    const { blobs, uploads } = of(caller.project.key);
    const tooLarge = (): Response =>
      errorResponse('payload_too_large', `A file may be at most ${limits.maxUploadBytes} bytes.`);
    const declared = Number(req.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > limits.maxUploadBytes) return tooLarge();
    if (req.body === null) return errorResponse('invalid_body', 'The body is empty.');
    const mime = (req.headers.get('content-type') ?? DEFAULT_MIME).slice(0, MAX_MIME);
    try {
      await blobs.put(capped(req.body, limits.maxUploadBytes), mime, sha);
    } catch (e) {
      if (e instanceof TooLarge) return tooLarge();
      if (e instanceof BlobHashMismatch)
        return errorResponse('conflict', 'The bytes do not match the hash in the path.');
      throw e;
    }
    // Only a caller who sent the real bytes becomes an uploader, and the answer never tells whether the server had
    // them already (WP-757): the bytes are always read and hashed, even when stored.
    uploads.record(caller.actor, sha);
    return withParticipant(new Response(null, { status: 201 }), caller.actor.id);
  };

  const head: BlobHandlers['head'] = async (req, ctx) => {
    const caller = authorizeProject(deps, req, ctx.params.project, DEVICE_KINDS);
    if (caller instanceof Response) return caller;
    const sha = ctx.params.sha;
    if (!SHA256_PATTERN.test(sha)) return new Response(null, { status: 404 });
    const { blobs, uploads, access } = of(caller.project.key);
    // Only for a file the caller uploaded or may read: any other answers like a missing file (WP-757).
    return blobs.has(sha) && (uploads.uploadedBy(caller.actor, sha) || access.allowed(caller.actor, sha))
      ? new Response(null, { status: 200 })
      : new Response(null, { status: 404 });
  };

  /** `GET ?thumb=<size>`: the derived WebP, made once per (sha, size) and cached next to the blob. */
  const thumbnail = async (
    thumbs: Thumbnails,
    sha: string,
    size: ThumbSizeKey,
    blob: { readonly mime: string; readonly stream: ByteSource },
    headers: Record<string, string>,
  ): Promise<Response> => {
    // The original's stream is only read on the first generation; a lazily opened file stream is closed either way.
    // It may be destroyed before the lazy open completes; a pending open that then fails must not crash the process
    // (same pattern as blobs/store.ts write).
    const stream = blob.stream as {
      on?: (event: string, listener: (e: Error) => void) => unknown;
      destroy?: (err?: Error) => unknown;
    };
    stream.on?.('error', () => undefined);
    let made;
    try {
      made = await thumbs.get(sha, size, blob.mime, () => blob.stream);
    } catch (e) {
      if (!(e instanceof ThumbnailFailed)) throw e;
      deps.log.log('blob.thumbnail_failed', { code: e.code, id: sha });
      return errorResponse('thumbnail_failed', `thumbnail ${e.code}`);
    } finally {
      stream.destroy?.();
    }
    if (made === undefined) return notFound();
    return new Response(Readable.toWeb(Readable.from(made.stream)) as ReadableStream<Uint8Array>, {
      status: 200,
      headers: {
        ...headers,
        'content-length': String(made.bytes),
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  };

  const get: BlobHandlers['get'] = async (req, ctx) => {
    const caller = authorizeProject(deps, req, ctx.params.project, DEVICE_KINDS);
    if (caller instanceof Response) return caller;
    const sha = ctx.params.sha;
    if (!SHA256_PATTERN.test(sha)) return notFound();
    const { blobs, access } = of(caller.project.key);
    if (!blobs.has(sha) || !access.allowed(caller.actor, sha)) return notFound();
    const headers = {
      // no-cache, not max-age: the browser must ask each time, so a photo erased or out of scope is not kept (WP-770); the
      // content hash makes the answer a cheap 304.
      'cache-control': 'private, no-cache',
      etag: `"${sha}"`,
    };
    const thumb = new URL(req.url).searchParams.get('thumb');
    if (thumb !== null) {
      const t = deps.thumbs;
      if (!THUMB_SIZES.has(thumb)) return notFound();
      const thumbHeaders = { ...headers, etag: `"${sha}-${thumb}"`, 'content-type': THUMB_MIME };
      // The thumbnail's own ETag, after authorisation, without generating or reading anything.
      if (req.headers.get('if-none-match') === thumbHeaders.etag)
        return new Response(null, { status: 304, headers: thumbHeaders });
      const blob = blobs.get(sha);
      if (blob === undefined) return notFound();
      return thumbnail(t(caller.project.key), sha, thumb, blob, thumbHeaders);
    }
    if (req.headers.get('if-none-match')?.includes(sha)) return new Response(null, { status: 304, headers });
    const blob = blobs.get(sha);
    if (blob === undefined) return notFound();
    return new Response(Readable.toWeb(Readable.from(blob.stream)) as ReadableStream<Uint8Array>, {
      status: 200,
      headers: {
        ...headers,
        'content-type': blob.mime,
        'content-length': String(blob.bytes),
        // Uploaded bytes are untrusted: never sniffed, never run as a page.
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  };

  return { put, head, get };
}
