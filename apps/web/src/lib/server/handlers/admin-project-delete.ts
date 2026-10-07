/**
 * `GET` (the counts of the confirm dialog) and `DELETE` (v3 `deleteProject`) of `/api/admin/projects/<project>`
 * over the real runtime (WP-388, A-037). The engine is `deleteProject` in `packages/server`.
 */
import {
  controlTemplateSource,
  createProjectDeleteHandlers,
  deleteCounts,
  deleteProject,
  effectiveDraftFile,
} from '@ueberblick/server';
import { authorizeAdmin } from '../authz';
import { config } from '../config';
import { runtime } from '../runtime';
import { json, type Call } from './http';

/** The one project delete of the app (R1): the admin's DELETE and a failed ZIP import's cleanup both use it. */
export function removeProject(key: string): boolean {
  const rt = runtime();
  return deleteProject(
    {
      control: rt.control,
      dataDir: config().dataDir,
      clock: rt.clock,
      dropPreview: (projectId) => rt.dropPreview(projectId),
      closeProject: (k) => rt.projectDb(k).close(),
    },
    key,
  );
}

const handlers = createProjectDeleteHandlers({
  // A-037 (provisional): any project membership may delete, as v3 and A-008; the seam for a later owner role.
  authorizeProjectDelete: (principal, key) => {
    const auth = authorizeAdmin(principal, key);
    return auth instanceof Response ? auth : { projectKey: auth.projectKey };
  },
  effectiveFile: (key) =>
    effectiveDraftFile(runtime().projectDb(key), controlTemplateSource(runtime().control)),
  counts: (key, file) => deleteCounts(runtime().projectDb(key), file),
  remove: removeProject,
});

const asCall = (call: Call) => ({
  request: call.request,
  params: call.params,
  principal: call.locals.admin,
});

export const adminProjectDeleteHandlers = {
  GET: (call: Call): Response => handlers.GET(asCall(call)),
  async DELETE(call: Call): Promise<Response> {
    if (call.request.headers.get('sec-fetch-site') !== 'same-origin')
      return json({ error: 'A change must come from the admin app (same origin).' }, 403);
    return handlers.DELETE(asCall(call));
  },
};
