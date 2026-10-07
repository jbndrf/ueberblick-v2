/**
 * `/api/admin/p/<project>/tiles` (A-044, WP-405): the admin side of an uploaded tile archive. Admin only
 * (`authorizeAdmin`), project-scoped like the other admin endpoints.
 *
 *   POST   tiles/uploads                  {kind, name, size, format?} -> 201 job           (kind: zip | mbtiles | pmtiles)
 *   PUT    tiles/uploads/<id>?offset=n    the chunk bytes as the body  -> job (`received`)
 *   POST   tiles/uploads/<id>/finish                                   -> 202 job (queued)
 *   GET    tiles/uploads/<id>                                          -> job: state, progress, result | error
 *   DELETE tiles/uploads/<id>                                          -> 204 (an open or failed upload; not a done one)
 *   DELETE tiles/<archive>                                             -> 204; 409 with the referencing keys
 *
 * A refusal is `{error: {code: 'upload_refused', reason, message, received?}}` with a `TILE_UPLOAD_REFUSALS` reason.
 */
import { tileUploadMax, type TemplateFile, type TileUploadRefusal } from '@ueberblick/core';
import { z } from '@ueberblick/core/zod';
import type { Principal } from '../../auth/contract';
import { archiveReferences, TileUploadError, type TileUploads } from '../../tiles/upload';
import { readBody } from '../shared/body';
import { errorResponse, jsonResponse } from '../shared/errors';

export interface TileUploadCall {
  readonly request: Request;
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly principal: Principal | null;
}

export interface TileUploadHandlerDeps {
  /** The refusing response (401, 403, 404), or the authorised project key. */
  authorizeAdmin(principal: Principal | null, projectKey: string): { readonly projectKey: string } | Response;
  readonly uploads: TileUploads;
  /** The configs whose layers may use an archive: the deployed one and the current draft. */
  configs(
    projectKey: string,
  ): readonly { readonly file: TemplateFile | undefined; readonly draft: boolean }[];
}

export interface TileUploadHandlers {
  start(call: TileUploadCall): Promise<Response>;
  chunk(call: TileUploadCall): Promise<Response>;
  finish(call: TileUploadCall): Response;
  status(call: TileUploadCall): Response;
  abort(call: TileUploadCall): Response;
  remove(call: TileUploadCall): Response;
}

const STATUS: Readonly<Record<TileUploadRefusal, number>> = {
  too_large: 413,
  too_many_tiles: 413,
  tile_too_large: 413,
  zip_bomb: 422,
  not_tiles: 422,
  corrupt: 422,
  wrong_format: 422,
  bad_chunk: 409,
  incomplete: 409,
  too_many_uploads: 409,
};

const StartBody = z
  .object({ kind: z.string(), name: z.string().max(200), size: z.number(), format: z.string().optional() })
  .strict();

const refused = (e: TileUploadError, extra: Record<string, unknown> = {}): Response =>
  jsonResponse(
    { error: { code: 'upload_refused', reason: e.reason, message: e.message, ...extra } },
    STATUS[e.reason],
  );

const noStore = (res: Response): Response => {
  res.headers.set('cache-control', 'private, no-store');
  return res;
};

export function createTileUploadHandlers(deps: TileUploadHandlerDeps): TileUploadHandlers {
  const { uploads } = deps;
  const project = (call: TileUploadCall): string | Response => {
    const auth = deps.authorizeAdmin(call.principal, call.params['project'] ?? '');
    return auth instanceof Response ? auth : auth.projectKey;
  };
  const notFound = (): Response => errorResponse('not_found', 'No such upload.');
  const job = (key: string, call: TileUploadCall) => uploads.status(key, call.params['id'] ?? '');

  return {
    async start(call) {
      const key = project(call);
      if (key instanceof Response) return key;
      const body = await readBody(call.request, StartBody, 4096);
      if (body instanceof Response) return body;
      try {
        return noStore(jsonResponse(uploads.start(key, body), 201));
      } catch (e) {
        if (e instanceof TileUploadError) return refused(e);
        throw e;
      }
    },

    async chunk(call) {
      const key = project(call);
      if (key instanceof Response) return key;
      const id = call.params['id'] ?? '';
      const current = uploads.status(key, id);
      if (current === undefined) return notFound();
      const offset = Number(new URL(call.request.url).searchParams.get('offset'));
      if (!Number.isSafeInteger(offset) || offset < 0)
        return errorResponse('invalid_query', 'offset must be the number of bytes received so far.');
      const declared = Number(call.request.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > tileUploadMax('chunk_bytes'))
        return errorResponse(
          'payload_too_large',
          `A chunk may be at most ${tileUploadMax('chunk_bytes')} bytes.`,
        );
      if (call.request.body === null) return errorResponse('invalid_body', 'The chunk is empty.');
      try {
        return noStore(jsonResponse(await uploads.chunk(key, id, offset, call.request.body)));
      } catch (e) {
        if (e instanceof TileUploadError)
          return refused(e, { received: uploads.status(key, id)?.received ?? 0 });
        throw e;
      }
    },

    finish(call) {
      const key = project(call);
      if (key instanceof Response) return key;
      if (job(key, call) === undefined) return notFound();
      try {
        return noStore(jsonResponse(uploads.finish(key, call.params['id'] ?? ''), 202));
      } catch (e) {
        if (e instanceof TileUploadError) return refused(e, { received: job(key, call)?.received ?? 0 });
        throw e;
      }
    },

    status(call) {
      const key = project(call);
      if (key instanceof Response) return key;
      const found = job(key, call);
      return found === undefined ? notFound() : noStore(jsonResponse(found));
    },

    abort(call) {
      const key = project(call);
      if (key instanceof Response) return key;
      try {
        if (!uploads.abort(key, call.params['id'] ?? ''))
          return errorResponse('not_found', 'No open upload with this id.');
      } catch (e) {
        if (e instanceof TileUploadError) return refused(e, { received: job(key, call)?.received ?? 0 });
        throw e;
      }
      return new Response(null, { status: 204 });
    },

    remove(call) {
      const key = project(call);
      if (key instanceof Response) return key;
      const id = call.params['archive'] ?? '';
      if (uploads.archivePath(key, id) === undefined)
        return errorResponse('not_found', 'No such tile archive.');
      const url = `/api/p/${key}/tiles/archives/${id}.pmtiles`;
      const configs = deps.configs(key);
      const live = new Set(configs.filter((c) => !c.draft).flatMap((c) => archiveReferences(c.file, url)));
      const inDraft = configs
        .filter((c) => c.draft)
        .flatMap((c) => archiveReferences(c.file, url))
        .filter((k) => !live.has(k))
        .map((k) => `${k} (Entwurf)`);
      const used = [...live, ...inDraft];
      if (used.length > 0)
        return jsonResponse(
          {
            error: {
              code: 'conflict',
              message: `The archive is still used by ${used.join(', ')}.`,
              references: used,
            },
          },
          409,
        );
      uploads.removeArchive(key, id);
      return new Response(null, { status: 204 });
    },
  };
}
