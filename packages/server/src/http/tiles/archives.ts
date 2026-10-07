/**
 * `GET /api/p/<project>/tiles/archives/<archive>.pmtiles` (A-044, WP-405): an uploaded tile archive, served from the
 * instance with HTTP range requests (the PMTiles protocol). Participants and admins of the project may read it
 * (`authorizeProject`: 401 without a session, 403 for another project). An unknown archive is 404.
 * The file never changes under its id, so it is cached privately for a day.
 */
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { ARCHIVE_ID } from '../../tiles/upload';
import { authorizeProject, DEVICE_KINDS } from '../shared/access';
import type { Handler, ProjectAccessDeps } from '../shared/contract';
import { errorResponse } from '../shared/errors';
import { parseByteRange } from '../shared/range';

export interface ArchiveHandlerDeps extends ProjectAccessDeps {
  /** The file of a finished upload, or undefined. */
  archivePath(projectKey: string, id: string): string | undefined;
}

export type ArchiveHandler = Handler<{ readonly project: string; readonly archive: string }>;

export function createArchiveHandler(deps: ArchiveHandlerDeps): ArchiveHandler {
  return async (req, ctx) => {
    const caller = authorizeProject(deps, req, ctx.params.project, DEVICE_KINDS);
    if (caller instanceof Response) return caller;
    const id = ctx.params.archive;
    const path = ARCHIVE_ID.test(id) ? deps.archivePath(caller.project.key, id) : undefined;
    if (path === undefined) return errorResponse('not_found', 'No such tile archive.');
    const size = statSync(path).size;
    const headers: Record<string, string> = {
      'content-type': 'application/octet-stream',
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=86400, immutable',
      etag: `"${id}"`,
      vary: 'Cookie',
    };
    const range = parseByteRange(req.headers.get('range'), size);
    if (range.kind === 'unsatisfiable')
      return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
    const [start, end, status] =
      range.kind === 'partial' ? [range.start, range.end, 206] : [0, size - 1, 200];
    headers['content-length'] = String(end - start + 1);
    if (range.kind === 'partial') headers['content-range'] = `bytes ${start}-${end}/${size}`;
    if (req.method === 'HEAD') return new Response(null, { status, headers });
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>;
    return new Response(body, { status, headers });
  };
}
