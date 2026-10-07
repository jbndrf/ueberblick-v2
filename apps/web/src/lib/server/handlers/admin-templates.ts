/**
 * The admin endpoints of the Projekte page's ⋮ menu over the real runtime (WP-383, S3-7):
 * `POST /api/admin/templates`, `GET /api/admin/projects/<project>/schema`, `POST /api/admin/projects/import`.
 *
 * Publishing is `publishTemplateVersion` in `packages/server` (WP-395): the handlers call it themselves, the same
 * function the Versions page uses (R1); the app only hands them the runtime's control database and clock.
 */
import {
  controlTemplateSource,
  createAdminProjectsHandlers,
  createAdminTemplatesHandlers,
  effectiveDeployedFile,
  effectiveDraftFile,
  importProjectFile,
} from '@ueberblick/server';
import { authorizeAdmin } from '../authz';
import { runtime } from '../runtime';
import type { Call } from './http';

const templates = createAdminTemplatesHandlers({
  authorizeAdmin,
  deployedFile: (key) => effectiveDeployedFile(runtime().projectDb(key)),
  publishContext: () => {
    const rt = runtime();
    return { control: rt.control, clock: rt.clock };
  },
});

const projects = createAdminProjectsHandlers({
  authorizeAdmin,
  effectiveFile: (key) =>
    effectiveDraftFile(runtime().projectDb(key), controlTemplateSource(runtime().control)),
  importFile: (text, by, name) => {
    const rt = runtime();
    return importProjectFile(
      { control: rt.control, openProjectDb: rt.projectDb, clock: rt.clock },
      text,
      by,
      name,
    );
  },
});

const asCall = (call: Call) => ({
  request: call.request,
  params: call.params,
  principal: call.locals.admin,
});

export const adminTemplatesHandlers = {
  POST: (call: Call): Promise<Response> => templates.POST(asCall(call)),
  GET_SCHEMA: (call: Call): Response => projects.GET_SCHEMA(asCall(call)),
  POST_IMPORT: (call: Call): Promise<Response> => projects.POST_IMPORT(asCall(call)),
};
