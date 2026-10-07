import {
  createTileUploadHandlers,
  draftTemplateFile,
  tileUploadsFor,
  type TileUploadHandlers,
} from '@ueberblick/server';
import { authorizeAdmin } from '../authz';
import { runtime } from '../runtime';
import type { Call } from './http';

let handlers: TileUploadHandlers | undefined;
const uploads = (): TileUploadHandlers =>
  (handlers ??= createTileUploadHandlers({
    authorizeAdmin,
    uploads: tileUploadsFor(runtime()),
    configs: (key) => [
      { file: runtime().services.deployed(key)?.config.file, draft: false },
      { file: draftTemplateFile(runtime().projectDb(key), runtime().templates), draft: true },
    ],
  }));

/**
 * `POST|PUT|GET|DELETE /api/admin/projects/<key>/tiles/uploads[/<id>[/finish]]` and `DELETE …/tiles/<archive>`
 * (A-044, WP-405): the chunked upload of a tile archive, its status, and the removal of a finished archive.
 */
export const tileUploadRoute =
  (name: keyof TileUploadHandlers) =>
  (call: Call): Response | Promise<Response> =>
    uploads()[name]({
      request: call.request,
      params: { ...call.params, project: call.params['key'] ?? '' },
      principal: call.locals.admin,
    });
